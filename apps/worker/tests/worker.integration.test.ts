import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import {
  createDatabase,
  gameEntries,
  matchParticipants,
  matches,
  migrationsFolder,
  users,
} from "@si-arena/db";
import { paperCatalogEntry } from "@si-arena/game-paper";
import { officialBotUrl, paperGame } from "@si-arena/game-paper/game";
import { replayMatch } from "@si-arena/engine";
import { readReplayFile } from "@si-arena/engine/node";
import { claimNextMatch, failExpiredLeases, renewLease } from "../src/claim";
import { runClaimedMatch, type WorkerJobContext } from "../src/execute";
import { claimableReleases, findWorkerGame } from "../src/games";
import { ReplayStore } from "../src/replay-store";
import { settleMatch, type SettleInput } from "../src/settle";

/**
 * Requires a real PostgreSQL reachable through ARENA_TEST_DATABASE_URL (see README).
 * The suite creates and drops its own throwaway database; skipped when unset.
 */
const databaseUrl = process.env.ARENA_TEST_DATABASE_URL ?? "";
const dbTest = process.env.ARENA_TEST_DATABASE_URL ? test : test.skip;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let database: ReturnType<typeof createDatabase>;
let admin: Client;
let testDbName = "";
let store: ReplayStore;
let replaysRoot: string;
let ctx: WorkerJobContext;
let officialSource: string;
let userCounter = 0;
let matchCounter = 0;

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function createUser() {
  const username = `wk${userCounter++}`;
  const rows = await database.db
    .insert(users)
    .values({ normalizedUsername: username, official: false })
    .returning();
  const user = rows[0]!;
  return { id: user.id, username };
}

async function createEntry(userId: string, overrides: { botProtocolVersion?: number } = {}) {
  await database.db.insert(gameEntries).values({
    gameId: paperCatalogEntry.id,
    userId,
    sourceCode: officialSource,
    sourceBytes: Buffer.byteLength(officialSource, "utf8"),
    botProtocolVersion: overrides.botProtocolVersion ?? paperCatalogEntry.botProtocolVersion,
  });
}

async function createPendingMatch(
  a: { id: string; username: string },
  b: { id: string; username: string },
  overrides: { release?: string } = {},
) {
  const rows = await database.db
    .insert(matches)
    .values({
      gameId: paperCatalogEntry.id,
      release: overrides.release ?? paperCatalogEntry.release,
      config: paperCatalogEntry.config,
      resolvedLimits: paperCatalogEntry.resolvedLimits,
      botProtocolVersion: paperCatalogEntry.botProtocolVersion,
      seed: 12345,
      initiatorId: a.id,
      idempotencyKey: `worker-test-${matchCounter++}`,
      status: "pending",
    })
    .returning();
  const match = rows[0]!;
  await database.db.insert(matchParticipants).values([
    {
      matchId: match.id,
      userId: a.id,
      slot: 0,
      nameSnapshot: a.username,
      officialSnapshot: false,
    },
    {
      matchId: match.id,
      userId: b.id,
      slot: 1,
      nameSnapshot: b.username,
      officialSnapshot: false,
    },
  ]);
  return match;
}

async function matchRow(matchId: string) {
  const rows = await database.db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return rows[0]!;
}

/** Persistence fixture: settlement does not execute bots or interpret replay bytes. */
async function stagedSettlement(): Promise<SettleInput> {
  const first = await createUser();
  const second = await createUser();
  await createEntry(first.id);
  await createEntry(second.id);
  const pending = await createPendingMatch(first, second);
  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim?.id).toBe(pending.id);
  const candidatePath = store.candidatePath(pending.id, claim!.executionId);
  await writeFile(candidatePath, "immutable settlement replay fixture");
  return {
    matchId: pending.id,
    executionId: claim!.executionId,
    candidatePath,
    replayFile: await store.inspect(candidatePath, pending.id),
    result: {
      reason: "ticks-exhausted",
      completedTicks: 1,
      players: [
        { id: first.id, rank: 1, score: 1 },
        { id: second.id, rank: 2, score: 0 },
      ],
    },
  };
}

/** A claimed match of any kind and size, ready to settle with the given ranks. */
async function stagedRun(
  kind: "practice" | "arena" | "solo",
  seats: Array<{ official?: boolean; boss?: boolean }>,
  ranks: number[],
  scores?: number[],
): Promise<SettleInput> {
  const people = [];
  for (const seat of seats) {
    const user = await createUser();
    if (seat.official)
      await database.db.update(users).set({ official: true }).where(eq(users.id, user.id));
    await createEntry(user.id);
    people.push({ ...user, official: seat.official ?? false });
  }
  const [match] = await database.db
    .insert(matches)
    .values({
      gameId: paperCatalogEntry.id,
      release: paperCatalogEntry.release,
      config: paperCatalogEntry.config,
      resolvedLimits: paperCatalogEntry.resolvedLimits,
      botProtocolVersion: paperCatalogEntry.botProtocolVersion,
      seed: 7,
      initiatorId: people[0]!.id,
      idempotencyKey: `worker-test-${matchCounter++}`,
      kind,
      status: "pending",
    })
    .returning();
  await database.db.insert(matchParticipants).values(
    people.map((person, slot) => ({
      matchId: match!.id,
      userId: person.id,
      slot,
      nameSnapshot: person.username,
      officialSnapshot: person.official,
    })),
  );
  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim?.id).toBe(match!.id);
  const candidatePath = store.candidatePath(match!.id, claim!.executionId);
  await writeFile(candidatePath, `${kind} settlement fixture`);
  return {
    matchId: match!.id,
    executionId: claim!.executionId,
    candidatePath,
    replayFile: await store.inspect(candidatePath, match!.id),
    result: {
      reason: "fixture",
      completedTicks: 1,
      players: people.map((person, index) => ({
        id: person.id,
        rank: ranks[index]!,
        score: scores?.[index] ?? 0,
      })),
    },
  };
}

async function entryOf(userId: string) {
  const [entry] = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.userId, userId));
  return entry!;
}

/** A claimed solo run for an existing user, ready to settle with the given score. */
async function soloRunOf(userId: string, score: number): Promise<SettleInput> {
  const [user] = await database.db.select().from(users).where(eq(users.id, userId));
  const [match] = await database.db
    .insert(matches)
    .values({
      gameId: paperCatalogEntry.id,
      release: paperCatalogEntry.release,
      config: paperCatalogEntry.config,
      resolvedLimits: paperCatalogEntry.resolvedLimits,
      botProtocolVersion: paperCatalogEntry.botProtocolVersion,
      seed: 7,
      initiatorId: userId,
      idempotencyKey: `worker-test-${matchCounter++}`,
      kind: "solo",
      status: "pending",
    })
    .returning();
  await database.db.insert(matchParticipants).values({
    matchId: match!.id,
    userId,
    slot: 0,
    nameSnapshot: user!.normalizedUsername,
    officialSnapshot: false,
  });
  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim?.id).toBe(match!.id);
  const candidatePath = store.candidatePath(match!.id, claim!.executionId);
  await writeFile(candidatePath, "solo settlement fixture");
  return {
    matchId: match!.id,
    executionId: claim!.executionId,
    candidatePath,
    replayFile: await store.inspect(candidatePath, match!.id),
    result: {
      reason: "fixture",
      completedTicks: 1,
      players: [{ id: userId, rank: 1, score }],
    },
  };
}

dbTest(
  "practice settlement records ranks and scores without touching anyone's standing",
  async () => {
    const input = await stagedRun("practice", [{}, { official: true }], [1, 2], [7, 3]);
    expect((await settleMatch(database.db, store, input)).outcome).toBe("completed");
    const seats = await database.db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, input.matchId))
      .orderBy(matchParticipants.slot);
    expect(seats.map((seat) => [seat.rank, seat.score, seat.ratingAfter])).toEqual([
      [1, 7, null],
      [2, 3, null],
    ]);
    for (const player of input.result.players)
      expect(await entryOf(player.id)).toMatchObject({ rating: "1000.000000", matchesPlayed: 0 });
  },
);

dbTest("arena settlement moves ratings pairwise by rank and prunes old runs", async () => {
  const arena = { seats: 5, keepMatches: 1 };
  const first = await stagedRun("arena", [{}, {}, { official: true }], [2, 1, 3]);
  const settled = await settleMatch(database.db, store, { ...first, arena });
  expect(settled).toEqual({ outcome: "completed", prunedMatchIds: [] });
  const [a, b, official] = first.result.players;
  // Two scored players duel with full K: rank 1 takes +16, rank 2 takes -16.
  expect(await entryOf(a!.id)).toMatchObject({
    rating: "984.000000",
    placementTotal: 2,
    matchesPlayed: 1,
    wins: 0,
  });
  expect(await entryOf(b!.id)).toMatchObject({
    rating: "1016.000000",
    placementTotal: 1,
    wins: 1,
  });
  expect(await entryOf(official!.id)).toMatchObject({ rating: "1000.000000", matchesPlayed: 0 });
  const seats = await database.db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, first.matchId))
    .orderBy(asc(matchParticipants.slot));
  expect(seats.map((seat) => [seat.rank, seat.ratingBefore, seat.ratingAfter])).toEqual([
    [2, "1000.000000", "984.000000"],
    [1, "1000.000000", "1016.000000"],
    [3, null, null],
  ]);

  const second = await stagedRun("arena", [{}, {}], [1, 1]);
  const next = await settleMatch(database.db, store, { ...second, arena });
  expect(next.prunedMatchIds).toEqual([first.matchId]);
  expect(
    await database.db.select().from(matches).where(eq(matches.id, first.matchId)),
  ).toHaveLength(0);
  // Equal ranks draw, so a tied championship leaves both ratings untouched.
  for (const player of second.result.players)
    expect(await entryOf(player.id)).toMatchObject({
      rating: "1000.000000",
      wins: 1,
      matchesPlayed: 1,
    });
});

dbTest("solo settlement keeps the best score and refuses repeats or bot seats", async () => {
  const player = await stagedRun("solo", [{}], [1], [120]);
  expect((await settleMatch(database.db, store, player)).outcome).toBe("completed");
  const userId = player.result.players[0]!.id;
  expect(await entryOf(userId)).toMatchObject({
    rating: "1000.000000",
    bestScore: 120,
    matchesPlayed: 1,
    wins: 0,
    losses: 0,
  });
  const seat = (
    await database.db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, player.matchId))
  )[0]!;
  expect([seat.rank, seat.score, seat.ratingBefore, seat.ratingAfter]).toEqual([
    1,
    120,
    null,
    null,
  ]);

  // A settled solo run is terminal: settling again is refused and scores nothing.
  expect((await settleMatch(database.db, store, player)).outcome).toBe("refused");

  // A worse later run still counts as played but never lowers the record;
  // a better one raises it.
  const worse = await soloRunOf(userId, 30);
  expect((await settleMatch(database.db, store, worse)).outcome).toBe("completed");
  expect(await entryOf(userId)).toMatchObject({ bestScore: 120, matchesPlayed: 2 });
  const better = await soloRunOf(userId, 200);
  expect((await settleMatch(database.db, store, better)).outcome).toBe("completed");
  expect(await entryOf(userId)).toMatchObject({ bestScore: 200, matchesPlayed: 3 });

  // Solo matches never seat the official bot or the boss.
  const officialRun = await stagedRun("solo", [{ official: true }], [1], [10]);
  await expect(settleMatch(database.db, store, officialRun)).rejects.toThrow(
    "Solo match cannot seat the official bot or the boss",
  );
});

dbTest("a solo arena run against the official bot counts play but no rating change", async () => {
  const solo = await stagedRun("arena", [{}, { official: true }], [1, 2]);
  const settled = await settleMatch(database.db, store, {
    ...solo,
    arena: { seats: 5, keepMatches: 3 },
  });
  expect(settled.outcome).toBe("completed");
  const [player, official] = solo.result.players;
  // No rated pair exists, so beating the bot moves nobody's rating.
  expect(await entryOf(player!.id)).toMatchObject({
    rating: "1000.000000",
    matchesPlayed: 1,
    wins: 1,
    placementTotal: 1,
  });
  expect(await entryOf(official!.id)).toMatchObject({
    rating: "1000.000000",
    matchesPlayed: 0,
  });
  const seats = await database.db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, solo.matchId))
    .orderBy(asc(matchParticipants.slot));
  expect(seats.map((seat) => [seat.rank, seat.ratingBefore, seat.ratingAfter])).toEqual([
    [1, "1000.000000", "1000.000000"],
    [2, null, null],
  ]);
});

beforeAll(async () => {
  admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  testDbName = `si_arena_wk_test_${process.pid.toString(36)}_${Date.now().toString(36)}`;
  await admin.query(`CREATE DATABASE ${testDbName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${testDbName}`;
  database = createDatabase(url.href);
  await migrate(database.db, { migrationsFolder });
  officialSource = await readFile(officialBotUrl, "utf8");
  replaysRoot = await mkdtemp(join(tmpdir(), "arena-worker-replays-"));
  store = new ReplayStore(replaysRoot);
  await store.prepare();
  ctx = { db: database.db, store, isolation: { kind: "local" } };
});

afterAll(async () => {
  // Each step is isolated so a failure above never prevents the database cleanup.
  if (replaysRoot) await rm(replaysRoot, { recursive: true, force: true }).catch(() => undefined);
  if (database) await database.close().catch(() => undefined);
  if (admin) {
    if (testDbName !== "") {
      await admin.query(`DROP DATABASE ${testDbName} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
});

dbTest(
  "a claimed match executes, publishes its replay, and settles ratings",
  { timeout: 120_000 },
  async () => {
    const first = await createUser();
    const second = await createUser();
    await createEntry(first.id);
    await createEntry(second.id);
    const pending = await createPendingMatch(first, second);

    const claim = await claimNextMatch(database.db, claimableReleases());
    expect(claim).not.toBeNull();
    expect(claim!.id).toBe(pending.id);
    expect(claim!.status).toBe("running");
    expect(claim!.executionId).toMatch(UUID_PATTERN);
    expect(claim!.leaseExpiresAt?.getTime()).toBeGreaterThan(Date.now());

    await runClaimedMatch(ctx, claim!);

    const row = await matchRow(pending.id);
    expect(row.status).toBe("completed");
    expect(row.failureReason).toBeNull();
    expect(row.leaseExpiresAt).toBeNull();
    const result = row.result!;
    expect(result.players).toHaveLength(2);
    const rankByUser = new Map(result.players.map((player) => [player.id, player.rank]));

    // The public file matches the stored reference exactly and replays cleanly.
    const finalPath = store.finalPath(pending.id);
    const info = await stat(finalPath);
    expect(row.replayFile).toMatchObject({
      fileName: `${pending.id}.json.gz`,
      formatVersion: 1,
      bytes: info.size,
    });
    expect(await sha256File(finalPath)).toBe(row.replayFile!.sha256);
    const raw = await readReplayFile(finalPath);
    const summary = await replayMatch(raw, paperGame, {});
    expect(summary.result).toEqual(result);
    for (const tick of (raw as { ticks: Array<{ logs?: unknown }> }).ticks) {
      expect(tick.logs).toBeUndefined();
    }

    // Settlement wrote both sides with zero-sum Elo from the starting 1000.
    const seats = await database.db
      .select()
      .from(matchParticipants)
      .where(eq(matchParticipants.matchId, pending.id))
      .orderBy(matchParticipants.slot);
    expect(seats).toHaveLength(2);
    const rankA = rankByUser.get(seats[0]!.userId)!;
    const rankB = rankByUser.get(seats[1]!.userId)!;
    const scoreA = rankA < rankB ? 1 : rankA === rankB ? 0.5 : 0;
    const entryRows = await database.db
      .select()
      .from(gameEntries)
      .where(eq(gameEntries.gameId, paperCatalogEntry.id));
    const entryByUser = new Map(entryRows.map((entry) => [entry.userId, entry]));
    let ratingSum = 0;
    for (const [index, seat] of seats.entries()) {
      const score = index === 0 ? scoreA : 1 - scoreA;
      expect(seat.rank).toBe(rankByUser.get(seat.userId));
      expect(seat.ratingBefore).toBe("1000.000000");
      const expected = score === 1 ? "1016.000000" : score === 0.5 ? "1000.000000" : "984.000000";
      expect(seat.ratingAfter).toBe(expected);
      const entry = entryByUser.get(seat.userId)!;
      expect(entry.matchesPlayed).toBe(1);
      expect(entry.wins).toBe(score === 1 ? 1 : 0);
      expect(entry.draws).toBe(score === 0.5 ? 1 : 0);
      expect(entry.losses).toBe(score === 0 ? 1 : 0);
      expect(entry.rating).toBe(expected);
      ratingSum += Number(entry.rating);
    }
    expect(ratingSum).toBe(2000);

    // Settling again is refused and changes nothing.
    const again = await settleMatch(database.db, store, {
      matchId: pending.id,
      executionId: claim!.executionId,
      result,
      replayFile: row.replayFile!,
      candidatePath: store.candidatePath(pending.id, claim!.executionId),
    });
    expect(again.outcome).toBe("refused");
    const unchanged = await matchRow(pending.id);
    expect(unchanged.status).toBe("completed");
    expect(unchanged.updatedAt).toEqual(row.updatedAt);
  },
);

dbTest("entries that drifted from the frozen release fail before execution", async () => {
  const initiator = await createUser();
  const stale = await createUser();
  await createEntry(initiator.id);
  await createEntry(stale.id, { botProtocolVersion: paperCatalogEntry.botProtocolVersion + 1 });
  const pending = await createPendingMatch(initiator, stale);

  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim!.id).toBe(pending.id);
  await runClaimedMatch(ctx, claim!);

  const row = await matchRow(pending.id);
  expect(row.status).toBe("failed");
  expect(row.failureReason).toBe("ENTRY_CHANGED_BEFORE_START");
  expect(row.replayFile).toBeNull();
  await expect(stat(store.finalPath(pending.id))).rejects.toThrow();
  const entries = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.userId, stale.id));
  expect(entries[0]!.matchesPlayed).toBe(0);
  expect(entries[0]!.rating).toBe("1000.000000");
});

dbTest("settlement is refused without matching execution rights", async () => {
  const first = await createUser();
  const second = await createUser();
  await createEntry(first.id);
  await createEntry(second.id);
  const pending = await createPendingMatch(first, second);
  const claim = await claimNextMatch(database.db, claimableReleases());
  expect(claim!.id).toBe(pending.id);

  // A different worker steals the execution id before this one settles.
  await database.db
    .update(matches)
    .set({ executionId: "00000000-0000-4000-8000-000000000001" })
    .where(eq(matches.id, pending.id));

  const outcome = await settleMatch(database.db, store, {
    matchId: pending.id,
    executionId: claim!.executionId,
    result: {
      reason: "ticks-exhausted",
      completedTicks: 1,
      players: [
        { id: first.id, rank: 1, score: 1 },
        { id: second.id, rank: 2, score: 0 },
      ],
    },
    replayFile: {
      fileName: `${pending.id}.json.gz`,
      formatVersion: 1,
      bytes: 1,
      sha256: "0".repeat(64),
    },
    candidatePath: store.candidatePath(pending.id, claim!.executionId),
  });
  expect(outcome.outcome).toBe("refused");
  const row = await matchRow(pending.id);
  expect(row.status).toBe("running");
  expect(row.replayFile).toBeNull();
  const entries = await database.db
    .select()
    .from(gameEntries)
    .where(eq(gameEntries.userId, first.id));
  expect(entries[0]!.matchesPlayed).toBe(0);
});

dbTest(
  "settlement retries a published candidate after the database transaction rolls back",
  async () => {
    const input = await stagedSettlement();
    await database.db.execute(sql`
    CREATE FUNCTION reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.status = 'completed' THEN
        RAISE EXCEPTION 'simulated settlement failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
    await database.db.execute(sql`
    CREATE TRIGGER reject_completion BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION reject_completion()
  `);
    try {
      await expect(settleMatch(database.db, store, input)).rejects.toThrow();
      const rolledBack = await matchRow(input.matchId);
      expect(rolledBack.status).toBe("running");
      expect(rolledBack.result).toBeNull();
      expect(rolledBack.replayFile).toBeNull();
      const seats = await database.db
        .select()
        .from(matchParticipants)
        .where(eq(matchParticipants.matchId, input.matchId));
      expect(seats.every((seat) => seat.rank === null && seat.ratingAfter === null)).toBe(true);
      for (const player of input.result.players) {
        const [entry] = await database.db
          .select()
          .from(gameEntries)
          .where(eq(gameEntries.userId, player.id));
        expect(entry).toMatchObject({
          rating: "1000.000000",
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
        });
      }
      expect(await sha256File(store.finalPath(input.matchId))).toBe(input.replayFile.sha256);
    } finally {
      await database.db.execute(sql`DROP TRIGGER reject_completion ON matches`);
      await database.db.execute(sql`DROP FUNCTION reject_completion()`);
    }

    expect((await settleMatch(database.db, store, input)).outcome).toBe("completed");
    expect((await settleMatch(database.db, store, input)).outcome).toBe("refused");
    const completed = await matchRow(input.matchId);
    expect(completed.status).toBe("completed");
    expect(completed.replayFile).toEqual(input.replayFile);
    for (const [index, player] of input.result.players.entries()) {
      const [entry] = await database.db
        .select()
        .from(gameEntries)
        .where(eq(gameEntries.userId, player.id));
      expect(entry).toMatchObject({
        rating: index === 0 ? "1016.000000" : "984.000000",
        matchesPlayed: 1,
        wins: index === 0 ? 1 : 0,
        losses: index === 0 ? 0 : 1,
      });
    }
    expect(await renewLease(database.db, input.matchId, input.executionId)).toBe(false);
  },
);

dbTest("expired leases cannot be renewed or settled before the expiry sweep", async () => {
  const input = await stagedSettlement();
  expect(await renewLease(database.db, input.matchId, randomUUID())).toBe(false);
  expect(await renewLease(database.db, input.matchId, input.executionId)).toBe(true);
  const expiredAt = new Date(Date.now() - 10_000);
  await database.db
    .update(matches)
    .set({ leaseExpiresAt: expiredAt })
    .where(eq(matches.id, input.matchId));
  const before = await matchRow(input.matchId);

  expect(await renewLease(database.db, input.matchId, input.executionId)).toBe(false);
  expect((await settleMatch(database.db, store, input)).outcome).toBe("refused");
  const after = await matchRow(input.matchId);
  expect(after.leaseExpiresAt).toEqual(expiredAt);
  expect(after.updatedAt).toEqual(before.updatedAt);
  expect(after.status).toBe("running");
  await expect(stat(store.finalPath(input.matchId))).rejects.toMatchObject({ code: "ENOENT" });
  for (const player of input.result.players) {
    const [entry] = await database.db
      .select()
      .from(gameEntries)
      .where(eq(gameEntries.userId, player.id));
    expect(entry).toMatchObject({ rating: "1000.000000", matchesPlayed: 0 });
  }
  await failExpiredLeases(database.db);
  expect((await matchRow(input.matchId)).failureReason).toBe("WORKER_LOST");
});

dbTest("a lease that expires while renewal waits for a row lock stays expired", async () => {
  const input = await stagedSettlement();
  await database.db
    .update(matches)
    .set({ leaseExpiresAt: sql`clock_timestamp() + interval '1 second'` })
    .where(eq(matches.id, input.matchId));
  let renewal: Promise<boolean> | undefined;
  await database.db.transaction(async (tx) => {
    await tx
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, input.matchId))
      .for("update");
    renewal = renewLease(database.db, input.matchId, input.executionId);
    // The lock owner does not modify the row, so passing this test requires a
    // fresh expiry check after locking, not just a statement-start predicate.
    await tx.execute(sql`SELECT pg_sleep(1.1)`);
  });
  expect(await renewal).toBe(false);
  await failExpiredLeases(database.db);
  expect((await matchRow(input.matchId)).failureReason).toBe("WORKER_LOST");
});

dbTest("expired leases are failed by the sweep and claims skip unknown releases", async () => {
  const first = await createUser();
  const second = await createUser();
  await createEntry(first.id);
  await createEntry(second.id);
  const abandoned = await createPendingMatch(first, second);
  await database.db
    .update(matches)
    .set({
      status: "running",
      leaseExpiresAt: new Date(Date.now() - 60_000),
      executionId: "00000000-0000-4000-8000-000000000002",
    })
    .where(eq(matches.id, abandoned.id));

  const swept = await failExpiredLeases(database.db);
  expect(swept).toBeGreaterThanOrEqual(1);
  const row = await matchRow(abandoned.id);
  expect(row.status).toBe("failed");
  expect(row.failureReason).toBe("WORKER_LOST");

  // Unknown frozen releases are never claimed by this worker; with no other
  // claimable pending match the probe returns null.
  await createPendingMatch(first, second, { release: "paper@9.9.9" });
  expect(await claimNextMatch(database.db, claimableReleases())).toBeNull();

  // Concurrent claims pick distinct rows via SKIP LOCKED; each fresh initiator
  // owns exactly one unfinished match.
  const third = await createUser();
  const fourth = await createUser();
  await createEntry(third.id);
  await createEntry(fourth.id);
  const one = await createPendingMatch(third, first);
  const two = await createPendingMatch(fourth, second);

  // Concurrent claims pick distinct rows via SKIP LOCKED.
  const claims = await Promise.all([
    claimNextMatch(database.db, claimableReleases()),
    claimNextMatch(database.db, claimableReleases()),
  ]);
  const ids = new Set(claims.map((claimed) => claimed?.id));
  expect(ids.has(one.id)).toBe(true);
  expect(ids.has(two.id)).toBe(true);
  expect(ids.size).toBe(2);
});

dbTest(
  "a match runner system failure cannot publish a replay or change either rating",
  async () => {
    const first = await createUser();
    const second = await createUser();
    await createEntry(first.id);
    await createEntry(second.id);
    const pending = await createPendingMatch(first, second);
    const claim = await claimNextMatch(database.db, claimableReleases());
    expect(claim!.id).toBe(pending.id);
    const registration = findWorkerGame(claim!.gameId, claim!.release)!;
    const run = vi
      .spyOn(registration, "run")
      .mockRejectedValueOnce(new Error("Match runner exited"));
    try {
      await expect(runClaimedMatch(ctx, claim!)).rejects.toThrow("Match runner exited");
    } finally {
      run.mockRestore();
    }
    const row = await matchRow(pending.id);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("EXECUTION_FAILED");
    expect(row.replayFile).toBeNull();
    await expect(stat(store.finalPath(pending.id))).rejects.toThrow();
    await expect(stat(store.candidatePath(pending.id, claim!.executionId))).rejects.toThrow();
    for (const player of [first, second]) {
      const [entry] = await database.db
        .select()
        .from(gameEntries)
        .where(eq(gameEntries.userId, player.id));
      expect(entry).toMatchObject({ matchesPlayed: 0, rating: "1000.000000" });
    }
  },
);

dbTest(
  "claiming leaves matches pending when their frozen runner budget exceeds capacity",
  async () => {
    const first = await createUser(),
      second = await createUser();
    const pending = await createPendingMatch(first, second);
    const budget = pending.resolvedLimits.runnerMemoryBytes;
    expect(await claimNextMatch(database.db, claimableReleases(), budget - 1)).toBeNull();
    expect((await matchRow(pending.id)).status).toBe("pending");
    const claim = await claimNextMatch(database.db, claimableReleases(), budget);
    expect(claim?.id).toBe(pending.id);
  },
);
