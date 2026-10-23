import { randomInt } from "node:crypto";
import { and, desc, eq, lte, ne, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { GameCatalogEntry, MatchKind } from "@si-arena/protocol";
import { gameEntries, matchParticipants, matches, users } from "@si-arena/db";
import type { Executor } from "@si-arena/db";
import { RECENT_OPPONENT_MATCHES, selectOpponent } from "./opponent";

type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
type MatchRow = typeof matches.$inferSelect;

/** What the initiator asked for; the created match kind follows from it. */
export type MatchIntent =
  | { type: "matchmaking" }
  | { type: "challenge"; opponentId: string }
  | { type: "boss" };

export interface Seat {
  userId: string;
  username: string;
  official: boolean;
  boss: boolean;
}

/** A refused request with the API error to report. */
export class MatchRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Seat aliases for the recent-opponent lookup: any match this user took part in
// (either seat), paired with the other participant.
const selfSeat = alias(matchParticipants, "self_seat");
const otherSeat = alias(matchParticipants, "other_seat");

/** Entries whose code can run under the game's current release. */
export function runnableEntry(game: GameCatalogEntry): SQL {
  return and(
    eq(gameEntries.gameId, game.id),
    eq(gameEntries.botProtocolVersion, game.botProtocolVersion),
    lte(gameEntries.sourceBytes, game.resolvedLimits.codeBytes),
  )!;
}

/** The user's stored entry for a game, if any. */
export async function loadGameEntry(
  db: Executor,
  gameId: string,
  userId: string,
): Promise<typeof gameEntries.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(gameEntries)
    .where(and(eq(gameEntries.gameId, gameId), eq(gameEntries.userId, userId)))
    .limit(1);
  return rows[0];
}

/** Why a stored entry cannot run under the game's current release; null when it can. */
export type EntryNotRunnableCode = "NO_CODE" | "PROTOCOL_MISMATCH" | "CODE_TOO_LARGE";

export const ENTRY_NOT_RUNNABLE_MESSAGES: Record<EntryNotRunnableCode, string> = {
  NO_CODE: "尚未上传该游戏的选手代码",
  PROTOCOL_MISMATCH: "代码协议版本与当前发行不兼容，请重新上传",
  CODE_TOO_LARGE: "代码体积超过当前发行上限，请重新上传",
};

export function entryNotRunnableReason(
  entry: Awaited<ReturnType<typeof loadGameEntry>>,
  game: GameCatalogEntry,
): EntryNotRunnableCode | null {
  if (entry === undefined) return "NO_CODE";
  if (entry.botProtocolVersion !== game.botProtocolVersion) return "PROTOCOL_MISMATCH";
  if (entry.sourceBytes > game.resolvedLimits.codeBytes) return "CODE_TOO_LARGE";
  return null;
}

const seatColumns = {
  userId: users.id,
  username: users.normalizedUsername,
  official: users.official,
  boss: users.boss,
};

async function runnableSeat(
  tx: Transaction,
  game: GameCatalogEntry,
  where: SQL,
): Promise<Seat | undefined> {
  const rows = await tx
    .select(seatColumns)
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .where(and(runnableEntry(game), where))
    .limit(1);
  return rows[0];
}

async function matchmakingOpponent(
  tx: Transaction,
  game: GameCatalogEntry,
  initiatorId: string,
  initiatorRating: number,
): Promise<{ seat: Seat; kind: MatchKind }> {
  const candidates = await tx
    .select({ userId: gameEntries.userId, rating: gameEntries.rating })
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .where(
      and(
        runnableEntry(game),
        eq(users.official, false),
        eq(users.boss, false),
        ne(gameEntries.userId, initiatorId),
      ),
    );
  const recent = await tx
    .select({ opponentId: otherSeat.userId })
    .from(matches)
    .innerJoin(selfSeat, eq(selfSeat.matchId, matches.id))
    .innerJoin(otherSeat, eq(otherSeat.matchId, matches.id))
    .where(
      and(
        eq(matches.gameId, game.id),
        eq(matches.kind, "ranked"),
        eq(matches.status, "completed"),
        eq(selfSeat.userId, initiatorId),
        ne(otherSeat.userId, initiatorId),
      ),
    )
    .orderBy(desc(matches.createdAt))
    .limit(RECENT_OPPONENT_MATCHES);
  const selected = selectOpponent(
    initiatorRating,
    candidates.map((candidate) => ({ userId: candidate.userId, rating: Number(candidate.rating) })),
    recent.map((row) => row.opponentId),
  );
  if (selected !== null) {
    const seat = await runnableSeat(tx, game, eq(users.id, selected));
    if (seat === undefined) throw new Error(`Opponent user ${selected} is missing`);
    return { seat, kind: "ranked" };
  }
  // Nobody else can play: a practice game against the official bot.
  const official = await runnableSeat(tx, game, eq(users.official, true));
  if (official === undefined) throw new Error(`Official account entry is missing for ${game.id}`);
  return { seat: official, kind: "practice" };
}

async function resolveOpponent(
  tx: Transaction,
  game: GameCatalogEntry,
  initiatorId: string,
  initiatorRating: number,
  intent: MatchIntent,
): Promise<{ seat: Seat; kind: MatchKind }> {
  if (intent.type === "matchmaking")
    return matchmakingOpponent(tx, game, initiatorId, initiatorRating);
  if (intent.type === "boss") {
    const boss = await runnableSeat(tx, game, eq(users.boss, true));
    if (boss === undefined)
      throw new MatchRequestError(404, "BOSS_UNAVAILABLE", "该游戏暂未开放 Boss 挑战");
    return { seat: boss, kind: "boss" };
  }
  if (intent.opponentId === initiatorId)
    throw new MatchRequestError(409, "OPPONENT_IS_SELF", "不能挑战自己");
  const seat = await runnableSeat(
    tx,
    game,
    and(eq(users.id, intent.opponentId), eq(users.boss, false))!,
  );
  if (seat === undefined)
    throw new MatchRequestError(409, "OPPONENT_UNAVAILABLE", "对手不存在或当前代码无法参赛");
  return { seat, kind: "practice" };
}

/** Inserts a pending match with its seats in slot order. */
export async function insertMatch(
  tx: Transaction,
  game: GameCatalogEntry,
  options: { initiatorId: string; idempotencyKey: string; kind: MatchKind; seats: Seat[] },
): Promise<MatchRow> {
  const inserted = await tx
    .insert(matches)
    .values({
      gameId: game.id,
      release: game.release,
      config: game.config,
      resolvedLimits: game.resolvedLimits,
      botProtocolVersion: game.botProtocolVersion,
      seed: randomInt(0, 2 ** 32),
      initiatorId: options.initiatorId,
      idempotencyKey: options.idempotencyKey,
      kind: options.kind,
      status: "pending",
    })
    .returning();
  const created = inserted[0];
  if (created === undefined) throw new Error("match insert returned no row");
  await tx.insert(matchParticipants).values(
    options.seats.map((seat, slot) => ({
      matchId: created.id,
      userId: seat.userId,
      slot,
      nameSnapshot: seat.username,
      officialSnapshot: seat.official,
      bossSnapshot: seat.boss,
    })),
  );
  return created;
}

/** Creates a two-seat match for the initiator according to the intent. */
export async function createDuel(
  db: NodePgDatabase,
  game: GameCatalogEntry,
  options: {
    initiator: Seat;
    initiatorRating: number;
    idempotencyKey: string;
    intent: MatchIntent;
  },
): Promise<MatchRow> {
  return db.transaction(async (tx) => {
    const { seat, kind } = await resolveOpponent(
      tx,
      game,
      options.initiator.userId,
      options.initiatorRating,
      options.intent,
    );
    return insertMatch(tx, game, {
      initiatorId: options.initiator.userId,
      idempotencyKey: options.idempotencyKey,
      kind,
      seats: [options.initiator, seat],
    });
  });
}

/** Creates a single-seat solo run for the initiator; no opponent is involved. */
export async function createSoloRun(
  db: NodePgDatabase,
  game: GameCatalogEntry,
  options: { initiator: Seat; idempotencyKey: string },
): Promise<MatchRow> {
  return db.transaction(async (tx) =>
    insertMatch(tx, game, {
      initiatorId: options.initiator.userId,
      idempotencyKey: options.idempotencyKey,
      kind: "solo",
      seats: [options.initiator],
    }),
  );
}
