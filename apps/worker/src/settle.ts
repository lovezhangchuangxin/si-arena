import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { gameEntries, matchParticipants, matches } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import type { ArenaSettings, GameResult } from "@si-arena/protocol";
import { formatRating, pairwiseElo, scoreFromRanks, twoPlayerElo } from "./elo";
import type { ReplayStore } from "./replay-store";

export type SettleOutcome = "completed" | "refused";

export interface SettleResult {
  outcome: SettleOutcome;
  /** Arena runs deleted by retention; their replay files are removed after commit. */
  prunedMatchIds: string[];
}

type Transaction = Parameters<Parameters<Executor["transaction"]>[0]>[0];

export interface SettleInput {
  matchId: string;
  executionId: string;
  result: GameResult;
  /** Measured on the saved candidate before this call. */
  replayFile: { fileName: string; formatVersion: 1; bytes: number; sha256: string };
  candidatePath: string;
  /** The game's arena settings when it has one. */
  arena?: ArenaSettings;
}

function rankByUserId(result: GameResult): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const player of result.players) {
    if (!Number.isSafeInteger(player.rank)) {
      throw new Error("Match result is missing an integral rank for every player");
    }
    ranks.set(player.id, player.rank);
  }
  return ranks;
}

function scoreByUserId(result: GameResult): Map<string, number> {
  const scores = new Map<string, number>();
  for (const player of result.players) {
    if (typeof player.score !== "number" || !Number.isSafeInteger(player.score)) {
      throw new Error("Match result is missing an integral score for every player");
    }
    scores.set(player.id, player.score);
  }
  return scores;
}

/**
 * Publishes a finished match: one transaction verifies execution rights, settles
 * by match kind (Elo for ranked games, pairwise Elo for arena games, ranks only
 * for practice and boss games), links the replay candidate to its public name,
 * commits the terminal state and prunes old arena runs. Refusal leaves every
 * row and file untouched — a stale worker can never overwrite a valid settlement.
 */
export async function settleMatch(
  db: Executor,
  store: ReplayStore,
  input: SettleInput,
): Promise<SettleResult> {
  return db.transaction(async (tx) => {
    const matchRows = await tx
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.status, "running"),
          eq(matches.executionId, input.executionId),
          gt(matches.leaseExpiresAt, sql`now()`),
          isNull(matches.result),
          isNull(matches.replayFile),
        ),
      )
      .limit(1)
      .for("update");
    const match = matchRows[0];
    if (match === undefined) return { outcome: "refused", prunedMatchIds: [] };

    const seats = await tx
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, input.matchId))
      .orderBy(asc(matchParticipants.slot));
    const ranks = rankByUserId(input.result);
    const scores = scoreByUserId(input.result);
    for (const seat of seats) {
      if (!ranks.has(seat.userId)) throw new Error("Match result is missing a participant rank");
    }
    if (match.kind === "ranked") await settleRanked(tx, match.gameId, seats, ranks, scores);
    else if (match.kind === "arena") {
      if (input.arena === undefined) throw new Error("Arena match settled without arena settings");
      await settleArena(tx, match.gameId, seats, ranks, scores);
    } else if (match.kind === "solo") await settleSolo(tx, match.gameId, seats, ranks, scores);
    else await recordRanks(tx, seats, ranks, scores);

    await store.publish(input.candidatePath, input.matchId);
    await tx
      .update(matches)
      .set({
        status: "completed",
        result: input.result,
        replayFile: input.replayFile,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(matches.id, input.matchId),
          eq(matches.executionId, input.executionId),
          eq(matches.status, "running"),
        ),
      );
    const prunedMatchIds =
      match.kind === "arena" && input.arena !== undefined
        ? await pruneArenaRuns(tx, match.gameId, input.arena.keepMatches)
        : [];
    return { outcome: "completed" as const, prunedMatchIds };
  });
}

type Seat = typeof matchParticipants.$inferSelect;

/** Locks the entries of the given users in a stable order (deadlock-free). */
async function lockEntries(tx: Transaction, gameId: string, userIds: string[]) {
  const ordered = userIds.toSorted();
  const entries = await tx
    .select()
    .from(gameEntries)
    .where(and(eq(gameEntries.gameId, gameId), inArray(gameEntries.userId, ordered)))
    .orderBy(asc(gameEntries.userId))
    .for("update");
  const byUser = new Map(entries.map((entry) => [entry.userId, entry]));
  for (const userId of ordered)
    if (!byUser.has(userId)) throw new Error("Participant lost their game entry");
  return byUser;
}

/** Practice and boss games: ranks and scores only, nobody's standing changes. */
async function recordRanks(
  tx: Transaction,
  seats: Seat[],
  ranks: Map<string, number>,
  scores: Map<string, number>,
) {
  for (const seat of seats)
    await tx
      .update(matchParticipants)
      .set({ rank: ranks.get(seat.userId)!, score: scores.get(seat.userId) ?? 0 })
      .where(eq(matchParticipants.id, seat.id));
}

/** Two-player Elo on both entries, the passive opponent included. */
async function settleRanked(
  tx: Transaction,
  gameId: string,
  seats: Seat[],
  ranks: Map<string, number>,
  scoresByUser: Map<string, number>,
) {
  if (seats.length !== 2) throw new Error("Ranked match must settle exactly two participants");
  if (seats.some((seat) => seat.officialSnapshot || seat.bossSnapshot))
    throw new Error("Ranked match cannot seat the official bot or the boss");
  const entryByUser = await lockEntries(
    tx,
    gameId,
    seats.map((seat) => seat.userId),
  );
  const seatA = seats[0]!;
  const seatB = seats[1]!;
  const ratingA = Number(entryByUser.get(seatA.userId)!.rating);
  const ratingB = Number(entryByUser.get(seatB.userId)!.rating);
  const scoreA = scoreFromRanks(ranks.get(seatA.userId)!, ranks.get(seatB.userId)!);
  const { deltaA, deltaB } = twoPlayerElo(ratingA, ratingB, scoreA);
  const deltas = [deltaA, deltaB];
  const ratingsBefore = [ratingA, ratingB];
  for (const [index, seat] of seats.entries()) {
    const entry = entryByUser.get(seat.userId)!;
    const ratingAfter = ratingsBefore[index]! + deltas[index]!;
    const score = index === 0 ? scoreA : 1 - scoreA;
    await tx
      .update(gameEntries)
      .set({
        rating: formatRating(ratingAfter),
        matchesPlayed: entry.matchesPlayed + 1,
        wins: entry.wins + (score === 1 ? 1 : 0),
        draws: entry.draws + (score === 0.5 ? 1 : 0),
        losses: entry.losses + (score === 0 ? 1 : 0),
        updatedAt: sql`now()`,
      })
      .where(eq(gameEntries.id, entry.id));
    await tx
      .update(matchParticipants)
      .set({
        rank: ranks.get(seat.userId)!,
        score: scoresByUser.get(seat.userId) ?? 0,
        ratingBefore: formatRating(ratingsBefore[index]!),
        ratingAfter: formatRating(ratingAfter),
      })
      .where(eq(matchParticipants.id, seat.id));
  }
}

/**
 * Pairwise Elo by final rank for every ordinary seat; equal ranks draw, the
 * official bot and the boss keep their ranks without touching any standing.
 */
async function settleArena(
  tx: Transaction,
  gameId: string,
  seats: Seat[],
  ranks: Map<string, number>,
  scores: Map<string, number>,
) {
  const scored = seats.filter((seat) => !seat.officialSnapshot && !seat.bossSnapshot);
  if (scored.length > 0) {
    const entryByUser = await lockEntries(
      tx,
      gameId,
      scored.map((seat) => seat.userId),
    );
    const ratings = scored.map((seat) => Number(entryByUser.get(seat.userId)!.rating));
    const finalRanks = scored.map((seat) => ranks.get(seat.userId)!);
    const deltas = pairwiseElo(ratings, finalRanks);
    for (const [index, seat] of scored.entries()) {
      const entry = entryByUser.get(seat.userId)!;
      const rank = finalRanks[index]!;
      const ratingAfter = ratings[index]! + deltas[index]!;
      await tx
        .update(gameEntries)
        .set({
          rating: formatRating(ratingAfter),
          placementTotal: entry.placementTotal + rank,
          matchesPlayed: entry.matchesPlayed + 1,
          wins: entry.wins + (rank === 1 ? 1 : 0),
          updatedAt: sql`now()`,
        })
        .where(eq(gameEntries.id, entry.id));
      await tx
        .update(matchParticipants)
        .set({
          rank,
          score: scores.get(seat.userId) ?? 0,
          ratingBefore: formatRating(ratings[index]!),
          ratingAfter: formatRating(ratingAfter),
        })
        .where(eq(matchParticipants.id, seat.id));
    }
  }
  await recordRanks(
    tx,
    seats.filter((seat) => seat.officialSnapshot || seat.bossSnapshot),
    ranks,
    scores,
  );
}

/** Solo runs: one seat, the entry keeps its best score and run count. */
async function settleSolo(
  tx: Transaction,
  gameId: string,
  seats: Seat[],
  ranks: Map<string, number>,
  scores: Map<string, number>,
) {
  if (seats.length !== 1) throw new Error("Solo match must settle exactly one participant");
  if (seats[0]!.officialSnapshot || seats[0]!.bossSnapshot)
    throw new Error("Solo match cannot seat the official bot or the boss");
  const seat = seats[0]!;
  const score = scores.get(seat.userId) ?? 0;
  const entryByUser = await lockEntries(tx, gameId, [seat.userId]);
  const entry = entryByUser.get(seat.userId)!;
  await tx
    .update(gameEntries)
    .set({
      bestScore: Math.max(entry.bestScore, score),
      matchesPlayed: entry.matchesPlayed + 1,
      updatedAt: sql`now()`,
    })
    .where(eq(gameEntries.id, entry.id));
  await tx
    .update(matchParticipants)
    .set({ rank: ranks.get(seat.userId)!, score })
    .where(eq(matchParticipants.id, seat.id));
}

/**
 * Deletes finished runs of the arena beyond the newest `keep` (rows cascade to
 * participants). Returns their ids so the caller removes the replay files once
 * the transaction has committed.
 */
async function pruneArenaRuns(tx: Transaction, gameId: string, keep: number): Promise<string[]> {
  const stale = await tx
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        eq(matches.gameId, gameId),
        eq(matches.kind, "arena"),
        inArray(matches.status, ["completed", "failed"]),
      ),
    )
    .orderBy(desc(matches.createdAt), desc(matches.id))
    .offset(keep);
  const ids = stale.map((row) => row.id);
  if (ids.length > 0) await tx.delete(matches).where(inArray(matches.id, ids));
  return ids;
}
