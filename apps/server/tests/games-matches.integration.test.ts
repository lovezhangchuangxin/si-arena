import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { migrationsFolder } from "@si-arena/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { buildApp } from "../src/app";
import { createDatabase } from "@si-arena/db";
import { ensureBossAccount, ensureOfficialAccounts } from "../src/db/official";
import { gameEntries, matchParticipants, matches, users } from "@si-arena/db";
import { registeredGames } from "../src/games";
import type { InjectResponse } from "./helpers";

/**
 * Requires a real PostgreSQL reachable through ARENA_TEST_DATABASE_URL (see README).
 * The suite creates and drops its own throwaway database; skipped when the variable is unset.
 */
const databaseUrl = process.env.ARENA_TEST_DATABASE_URL ?? "";
const dbTest = process.env.ARENA_TEST_DATABASE_URL ? test : test.skip;

let app: ReturnType<typeof buildApp>;
let database: ReturnType<typeof createDatabase>;
let admin: Client;
let testDbName = "";
let replayDir = "";

let ipCounter = 0;
const uniqueIp = () => `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
let userCounter = 0;

async function call(
  method: string,
  url: string,
  options: { body?: unknown; ip?: string; token?: string; headers?: Record<string, string> } = {},
): Promise<InjectResponse> {
  const headers: Record<string, string> = { ...options.headers };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    payload = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  return app.inject({
    method,
    url,
    headers,
    remoteAddress: options.ip ?? uniqueIp(),
    ...(payload !== undefined ? { payload } : {}),
  });
}

interface TestUser {
  id: string;
  username: string;
  token: string;
}

async function registerUser(): Promise<TestUser> {
  const username = `gm${userCounter++}`;
  const reg = await call("POST", "/api/auth/register", {
    body: { username, password: "secret-pass" },
  });
  expect(reg.statusCode).toBe(201);
  const body = reg.json();
  return { id: body.user.id, username, token: body.token };
}

/** Makes every other ordinary player's code in `gameId` unrunnable, so only `keep` can be matched. */
async function onlyRunnable(keep: string[], gameId = "paper"): Promise<void> {
  const others = await database.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.official, false), eq(users.boss, false), notInArray(users.id, keep)));
  if (others.length === 0) return;
  await database.db
    .update(gameEntries)
    .set({ botProtocolVersion: 99 })
    .where(
      and(
        eq(gameEntries.gameId, gameId),
        inArray(
          gameEntries.userId,
          others.map((row) => row.id),
        ),
      ),
    );
}

async function uploadOfficialBot(token: string): Promise<void> {
  const paper = registeredGames.find((game) => game.entry.id === "paper");
  if (!paper) throw new Error("paper game is not registered");
  const source = await readFile(paper.officialBotUrl, "utf8");
  const res = await call("PUT", "/api/games/paper/me/code", {
    body: source,
    token,
    headers: { "content-type": "text/plain" },
  });
  expect(res.statusCode).toBe(200);
}

async function uploadTetrisBot(token: string): Promise<void> {
  const tetris = registeredGames.find((game) => game.entry.id === "tetris");
  if (!tetris) throw new Error("tetris game is not registered");
  const source = await readFile(tetris.officialBotUrl, "utf8");
  const res = await call("PUT", "/api/games/tetris/me/code", {
    body: source,
    token,
    headers: { "content-type": "text/plain" },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  testDbName = `si_arena_gm_test_${process.pid.toString(36)}_${Date.now().toString(36)}`;
  await admin.query(`CREATE DATABASE ${testDbName}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${testDbName}`;
  database = createDatabase(url.href);
  await migrate(database.db, {
    migrationsFolder,
  });
  await ensureOfficialAccounts(database.db, registeredGames);
  replayDir = await mkdtemp(join(tmpdir(), "si-arena-api-replays-"));
  app = buildApp({ db: database.db, replaysDir: replayDir });
});

afterAll(async () => {
  // Each step is isolated so a failure above never prevents the database cleanup.
  if (app) await app.close().catch(() => undefined);
  if (database) await database.close().catch(() => undefined);
  if (replayDir) await rm(replayDir, { recursive: true, force: true });
  if (admin) {
    if (testDbName !== "") {
      await admin.query(`DROP DATABASE ${testDbName} WITH (FORCE)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
});

dbTest("upload stores code, rejects invalid sources, and preserves the previous code", async () => {
  const user = await registerUser();

  const empty = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(empty.statusCode).toBe(200);
  const emptyBody = empty.json();
  expect(emptyBody.code).toBeNull();
  expect(emptyBody.canMatch).toBe(false);
  expect(emptyBody.cannotMatchReason).toBe("NO_CODE");
  expect(emptyBody.activeMatch).toBeNull();
  expect(emptyBody.entry).toMatchObject({ rating: 1000, matchesPlayed: 0 });

  await uploadOfficialBot(user.token);

  const afterUpload = await call("GET", "/api/games/paper/me", { token: user.token });
  const uploaded = afterUpload.json();
  expect(uploaded.canMatch).toBe(true);
  expect(uploaded.cannotMatchReason).toBeNull();
  expect(uploaded.code?.botProtocolVersion).toBe(2);
  expect(uploaded.code?.source).toContain("export default");

  const invalid = await call("PUT", "/api/games/paper/me/code", {
    body: "import x from 'x';export default ()=>x",
    token: user.token,
    headers: { "content-type": "text/plain" },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().code).toBe("CODE_INVALID");

  const preserved = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(preserved.json().code?.source).toBe(uploaded.code?.source);

  const wrongContentType = await call("PUT", "/api/games/paper/me/code", {
    body: { source: "export default ()=>1" },
    token: user.token,
  });
  expect(wrongContentType.statusCode).toBe(400);
});

dbTest("oversized uploads are rejected before validation", async () => {
  const user = await registerUser();
  const res = await call("PUT", "/api/games/paper/me/code", {
    body: `const padding="${"x".repeat(260 * 1024)}";export default ()=>1`,
    token: user.token,
    headers: { "content-type": "text/plain" },
  });
  expect(res.statusCode).toBe(413);
  expect(res.json().code).toBe("BODY_TOO_LARGE");
  const me = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(me.json().code).toBeNull();
});

dbTest("upload demands valid UTF-8 text and keeps private responses uncached", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);

  // A lone 0xff continuation byte must be rejected instead of silently
  // replaced, so the stored source always round-trips byte for byte.
  const invalid = await app.inject({
    method: "PUT",
    url: "/api/games/paper/me/code",
    headers: { authorization: `Bearer ${user.token}`, "content-type": "text/plain" },
    payload: Buffer.from([0x61, 0xff, 0x62]),
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().code).toBe("VALIDATION_ERROR");

  const empty = await call("PUT", "/api/games/paper/me/code", {
    token: user.token,
    headers: { "content-type": "text/plain" },
  });
  expect(empty.statusCode).toBe(400);
  expect(empty.json().code).toBe("VALIDATION_ERROR");

  const charset = await call("PUT", "/api/games/paper/me/code", {
    body: "export default () => 1",
    token: user.token,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  expect(charset.statusCode).toBe(200);
  expect(charset.headers["cache-control"]).toBe("no-store");

  // The rejected payloads above left the stored code untouched.
  const me = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(me.headers["cache-control"]).toBe("no-store");
  expect(me.json().code?.source).toBe("export default () => 1");
});

dbTest("concurrent uploads saturate the validation gate", async () => {
  const user = await registerUser();
  const paper = registeredGames.find((game) => game.entry.id === "paper");
  if (!paper) throw new Error("paper game is not registered");
  const source = await readFile(paper.officialBotUrl, "utf8");
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      call("PUT", "/api/games/paper/me/code", {
        body: source,
        token: user.token,
        headers: { "content-type": "text/plain" },
      }),
    ),
  );
  const statuses = results.map((res) => res.statusCode).toSorted();
  // The gate admits two validators and rejects the third instead of queueing.
  expect(statuses).toContain(429);
  expect(statuses.filter((status) => status === 200)).toHaveLength(2);
  expect(results.find((res) => res.statusCode === 429)?.json().code).toBe("RATE_LIMITED");
});

dbTest("with no other player, matching is practice against the official bot", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  await onlyRunnable([user.id]);

  const created = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "first-match" },
  });
  expect(created.statusCode).toBe(201);
  const match = created.json();
  expect(match.status).toBe("pending");
  expect(match.gameId).toBe("paper");
  expect(match.release).toBe("paper@0.3.0");
  expect(Number.isInteger(match.seed)).toBe(true);
  expect(match.seed).toBeGreaterThanOrEqual(0);
  expect(match.seed).toBeLessThanOrEqual(4294967295);
  expect(match.participants).toHaveLength(2);
  expect(match.participants[0]).toMatchObject({ userId: user.id, slot: 0, official: false });
  expect(match.participants[1]).toMatchObject({ username: "official", slot: 1, official: true });
  expect(match.kind).toBe("practice");

  const replay = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "first-match" },
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().id).toBe(match.id);

  const second = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "second-match" },
  });
  expect(second.statusCode).toBe(409);
  expect(second.json().code).toBe("MATCH_ALREADY_PENDING");
  expect(second.json().matchId).toBe(match.id);

  const detail = await call("GET", `/api/matches/${match.id}`);
  expect(detail.statusCode).toBe(200);
  expect(detail.json().id).toBe(match.id);

  const unknown = await call("GET", "/api/matches/00000000-0000-4000-8000-000000000000");
  expect(unknown.statusCode).toBe(404);
  expect(unknown.json().code).toBe("MATCH_NOT_FOUND");
  const malformed = await call("GET", "/api/matches/not-a-uuid");
  expect(malformed.statusCode).toBe(404);
});

dbTest("matching requires code, an idempotency key, and a session", async () => {
  const user = await registerUser();
  const noCode = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "no-code" },
  });
  expect(noCode.statusCode).toBe(409);
  expect(noCode.json().code).toBe("NO_CODE");

  await uploadOfficialBot(user.token);
  const noKey = await call("POST", "/api/games/paper/matches", { token: user.token });
  expect(noKey.statusCode).toBe(400);
  expect(noKey.json().code).toBe("VALIDATION_ERROR");
  const longKey = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "k".repeat(101) },
  });
  expect(longKey.statusCode).toBe(400);

  const anonymous = await call("POST", "/api/games/paper/matches", {
    headers: { "idempotency-key": "anon" },
  });
  expect(anonymous.statusCode).toBe(401);
  const anonymousMe = await call("GET", "/api/games/paper/me");
  expect(anonymousMe.statusCode).toBe(401);
});

dbTest("real opponents are preferred and the recent one is skipped when possible", async () => {
  const first = await registerUser();
  const second = await registerUser();
  await uploadOfficialBot(first.token);
  await uploadOfficialBot(second.token);
  // Keep the pairings below deterministic by pushing every other entry out of
  // the 250-point window around the 1000-rating participants.
  await database.db
    .update(gameEntries)
    .set({ rating: "5000.000000" })
    .where(
      and(eq(gameEntries.gameId, "paper"), notInArray(gameEntries.userId, [first.id, second.id])),
    );

  const created = await call("POST", "/api/games/paper/matches", {
    token: second.token,
    headers: { "idempotency-key": "real-opponent" },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().participants[1]).toMatchObject({ userId: first.id, official: false });
  const matchId: string = created.json().id;

  // Seed a completed match between second (initiator) and first so the next
  // request prefers a different opponent; cancel the pending row first.
  const third = await registerUser();
  await uploadOfficialBot(third.token);
  await database.db
    .update(matches)
    .set({ status: "failed", failureReason: "WORKER_LOST" })
    .where(eq(matches.id, matchId));
  const paperEntry = registeredGames.find((game) => game.entry.id === "paper")?.entry;
  if (!paperEntry) throw new Error("paper game is not registered");
  const seeded = await database.db
    .insert(matches)
    .values({
      gameId: "paper",
      release: paperEntry.release,
      config: paperEntry.config,
      resolvedLimits: paperEntry.resolvedLimits,
      botProtocolVersion: paperEntry.botProtocolVersion,
      seed: 12345,
      initiatorId: second.id,
      idempotencyKey: "seed-completed",
      status: "completed",
    })
    .returning({ id: matches.id });
  const seededId = seeded[0]?.id;
  if (!seededId) throw new Error("seed match insert failed");
  await database.db.insert(matchParticipants).values([
    {
      matchId: seededId,
      userId: second.id,
      slot: 0,
      nameSnapshot: second.username,
      officialSnapshot: false,
    },
    {
      matchId: seededId,
      userId: first.id,
      slot: 1,
      nameSnapshot: first.username,
      officialSnapshot: false,
    },
  ]);

  const next = await call("POST", "/api/games/paper/matches", {
    token: second.token,
    headers: { "idempotency-key": "after-completed" },
  });
  expect(next.statusCode).toBe(201);
  expect(next.json().participants[1]).toMatchObject({ userId: third.id, official: false });
});

dbTest("concurrent match creation converges on a single row", async () => {
  // IDEMPOTENCY_MISMATCH (the same key replayed against a different game)
  // needs a second registered game; the catalog currently ships only paper.
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "2000.000000" })
    .where(eq(gameEntries.userId, user.id));

  // Racing the same key: the loser's insert trips a unique constraint inside
  // the transaction and must converge on the winner's match (replay 200 or
  // explicit 409), never a second row or a 500.
  const sameKey = await Promise.all([
    call("POST", "/api/games/paper/matches", {
      token: user.token,
      headers: { "idempotency-key": "race-same" },
    }),
    call("POST", "/api/games/paper/matches", {
      token: user.token,
      headers: { "idempotency-key": "race-same" },
    }),
  ]);
  expect(sameKey.filter((res) => res.statusCode === 201)).toHaveLength(1);
  const ids = new Set(sameKey.map((res) => res.json().id ?? res.json().matchId));
  expect(ids.size).toBe(1);

  // Racing different keys: the partial unique active-match index keeps one
  // unfinished match per user; the loser reports 409 with the winner's id.
  const other = await registerUser();
  await uploadOfficialBot(other.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "2000.000000" })
    .where(eq(gameEntries.userId, other.id));
  const diffKey = await Promise.all([
    call("POST", "/api/games/paper/matches", {
      token: other.token,
      headers: { "idempotency-key": "race-a" },
    }),
    call("POST", "/api/games/paper/matches", {
      token: other.token,
      headers: { "idempotency-key": "race-b" },
    }),
  ]);
  const winner = diffKey.find((res) => res.statusCode === 201);
  const loser = diffKey.find((res) => res.statusCode === 409);
  expect(winner).toBeDefined();
  expect(loser).toBeDefined();
  expect(loser?.json().code).toBe("MATCH_ALREADY_PENDING");
  expect(loser?.json().matchId).toBe(winner?.json().id);
  expect(winner?.headers["cache-control"]).toBe("no-store");
});

dbTest(
  "stale protocol or oversized entries cannot match and are skipped as candidates",
  async () => {
    const initiator = await registerUser();
    const stale = await registerUser();
    const bulky = await registerUser();
    await uploadOfficialBot(initiator.token);
    await uploadOfficialBot(stale.token);
    await uploadOfficialBot(bulky.token);
    await onlyRunnable([initiator.id, stale.id, bulky.id]);
    // Simulate entries left behind by a protocol bump, plus one whose stored
    // size no longer fits the current release budget.
    await database.db
      .update(gameEntries)
      .set({ botProtocolVersion: 99 })
      .where(eq(gameEntries.userId, stale.id));
    await database.db
      .update(gameEntries)
      .set({ sourceBytes: 9_999_999 })
      .where(eq(gameEntries.userId, bulky.id));

    const staleMe = await call("GET", "/api/games/paper/me", { token: stale.token });
    expect(staleMe.json().canMatch).toBe(false);
    expect(staleMe.json().cannotMatchReason).toBe("PROTOCOL_MISMATCH");
    const rejected = await call("POST", "/api/games/paper/matches", {
      token: stale.token,
      headers: { "idempotency-key": "stale-initiator" },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe("PROTOCOL_MISMATCH");

    // Both ineligible entries are filtered out of the candidate pool, so the
    // only legal opponent left is the official fallback.
    const created = await call("POST", "/api/games/paper/matches", {
      token: initiator.token,
      headers: { "idempotency-key": "stale-candidate" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().participants[1]).toMatchObject({ official: true });
    expect(created.json().kind).toBe("practice");
  },
);

dbTest("matchmaking widens the rating window and prefers any real player", async () => {
  const initiator = await registerUser();
  const far = await registerUser();
  await uploadOfficialBot(initiator.token);
  await uploadOfficialBot(far.token);
  await onlyRunnable([initiator.id, far.id]);
  await database.db
    .update(gameEntries)
    .set({ rating: "2600.000000" })
    .where(eq(gameEntries.userId, initiator.id));
  const created = await call("POST", "/api/games/paper/matches", {
    token: initiator.token,
    headers: { "idempotency-key": "wide-window" },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().kind).toBe("ranked");
  expect(created.json().participants[1]).toMatchObject({ userId: far.id, official: false });
});

dbTest("challenges are practice and validate the opponent", async () => {
  const user = await registerUser();
  const rival = await registerUser();
  await uploadOfficialBot(user.token);
  await uploadOfficialBot(rival.token);
  const challenge = (body: unknown, key: string) =>
    call("POST", "/api/games/paper/matches", {
      token: user.token,
      body,
      headers: { "idempotency-key": key },
    });
  const self = await challenge({ opponentId: user.id }, "self");
  expect(self.statusCode).toBe(409);
  expect(self.json().code).toBe("OPPONENT_IS_SELF");
  const unknown = await challenge({ opponentId: "00000000-0000-4000-8000-000000000000" }, "nobody");
  expect(unknown.statusCode).toBe(409);
  expect(unknown.json().code).toBe("OPPONENT_UNAVAILABLE");
  for (const body of [{ opponentId: "x" }, { boss: false }, { extra: 1 }, [1]]) {
    const malformed = await challenge(body, `bad-${JSON.stringify(body)}`);
    expect(malformed.statusCode).toBe(400);
  }
  const created = await challenge({ opponentId: rival.id }, "rival");
  expect(created.statusCode).toBe(201);
  expect(created.json().kind).toBe("practice");
  expect(created.json().participants[1]).toMatchObject({ userId: rival.id, boss: false });
});

dbTest("the boss is private, unranked and recorded on /me", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  const before = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(before.json().boss).toEqual({ available: false, attempts: 0, wins: 0 });
  const unavailable = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    body: { boss: true },
    headers: { "idempotency-key": "boss-missing" },
  });
  expect(unavailable.statusCode).toBe(404);
  expect(unavailable.json().code).toBe("BOSS_UNAVAILABLE");

  const bossesDir = await mkdtemp(join(tmpdir(), "si-arena-bosses-"));
  try {
    const paper = registeredGames.find((game) => game.entry.id === "paper")!;
    await writeFile(join(bossesDir, "paper.js"), await readFile(paper.officialBotUrl, "utf8"));
    expect(await ensureBossAccount(database.db, registeredGames, bossesDir)).toEqual({
      games: ["paper"],
    });
    const after = await call("GET", "/api/games/paper/me", { token: user.token });
    expect(after.json().boss.available).toBe(true);
    const created = await call("POST", "/api/games/paper/matches", {
      token: user.token,
      body: { boss: true },
      headers: { "idempotency-key": "boss-challenge" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().kind).toBe("boss");
    expect(created.json().participants[1]).toMatchObject({ username: "boss", boss: true });
    const board = await call("GET", "/api/games/paper/leaderboard?limit=100");
    expect(board.json().players.some((p: { username: string }) => p.username === "boss")).toBe(
      false,
    );
    // Removing the file withdraws the boss again.
    await rm(join(bossesDir, "paper.js"));
    await ensureBossAccount(database.db, registeredGames, bossesDir);
    const withdrawn = await call("GET", "/api/games/paper/me", { token: user.token });
    expect(withdrawn.json().boss.available).toBe(false);
  } finally {
    await rm(bossesDir, { recursive: true, force: true });
  }
});

dbTest("games without an arena have no arena routes", async () => {
  const user = await registerUser();
  const status = await call("GET", "/api/games/paper/arena");
  expect(status.statusCode).toBe(404);
  const start = await call("POST", "/api/games/paper/arena", {
    token: user.token,
    headers: { "idempotency-key": "no-arena" },
  });
  expect(start.statusCode).toBe(404);
});

dbTest("leaderboard ranks entries with ties and pagination", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  const board = await call("GET", "/api/games/paper/leaderboard");
  expect(board.statusCode).toBe(200);
  const body = board.json();
  expect(body.total).toBeGreaterThanOrEqual(2);
  // The official bot plays practice games only and never appears on the board.
  expect(body.players.some((player: { official: boolean }) => player.official)).toBe(false);
  const mine = body.players.find((player: { userId: string }) => player.userId === user.id);
  expect(mine).toMatchObject({ rating: 1000, matchesPlayed: 0, placementTotal: 0 });
  const me = await call("GET", "/api/games/paper/me", { token: user.token });
  expect(me.json().entry).toMatchObject({ rank: mine.rank, placementTotal: 0 });
  // Equal internal ratings must share one rank; user id only breaks display order.
  const sameRated = body.players.filter((player: { rating: number }) => player.rating === 1000);
  expect(sameRated.length).toBeGreaterThan(1);
  const sameRatedRanks = new Set(sameRated.map((player: { rank: number }) => player.rank));
  expect(sameRatedRanks.size).toBe(1);

  const paged = await call("GET", "/api/games/paper/leaderboard?page=1&limit=1");
  expect(paged.statusCode).toBe(200);
  expect(paged.json().players).toHaveLength(1);
  expect(paged.json().limit).toBe(1);
  const pageBeyond = await call("GET", "/api/games/paper/leaderboard?page=99&limit=100");
  expect(pageBeyond.json().players).toHaveLength(0);
  // Extreme or unparseable page values clamp instead of overflowing the
  // database offset or failing the request.
  const hugePage = await call("GET", "/api/games/paper/leaderboard?page=1e12&limit=100");
  expect(hugePage.statusCode).toBe(200);
  expect(hugePage.json().page).toBe(1_000_000);
  expect(hugePage.json().players).toHaveLength(0);
  const garbagePage = await call("GET", "/api/games/paper/leaderboard?page=abc");
  expect(garbagePage.statusCode).toBe(200);
  expect(garbagePage.json().page).toBe(1);

  const missing = await call("GET", "/api/games/nothing/leaderboard");
  expect(missing.statusCode).toBe(404);
});

dbTest("solo runs are created bare and ranked by best score", async () => {
  const user = await registerUser();
  await uploadTetrisBot(user.token);

  // Solo games reject opponent and boss intents outright.
  const challenged = await call("POST", "/api/games/tetris/matches", {
    token: user.token,
    body: { opponentId: user.id },
    headers: { "idempotency-key": "solo-challenge" },
  });
  expect(challenged.statusCode).toBe(400);
  expect(challenged.json().code).toBe("VALIDATION_ERROR");
  const boss = await call("POST", "/api/games/tetris/matches", {
    token: user.token,
    body: { boss: true },
    headers: { "idempotency-key": "solo-boss" },
  });
  expect(boss.statusCode).toBe(400);

  // A bare matchmaking intent creates the single-seat solo run.
  const created = await call("POST", "/api/games/tetris/matches", {
    token: user.token,
    headers: { "idempotency-key": "solo-create" },
  });
  expect(created.statusCode).toBe(201);
  const body = created.json();
  expect(body.kind).toBe("solo");
  expect(body.participants).toHaveLength(1);
  expect(body.participants[0]).toMatchObject({ userId: user.id, slot: 0 });

  // Idempotent replays return the very same run.
  const replay = await call("POST", "/api/games/tetris/matches", {
    token: user.token,
    headers: { "idempotency-key": "solo-create" },
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().id).toBe(body.id);

  // The solo board orders by best score; fresh entries sit at 0 with a rank.
  const board = await call("GET", "/api/games/tetris/leaderboard");
  expect(board.statusCode).toBe(200);
  const players = board.json().players;
  expect(players.some((player: { userId: string }) => player.userId === user.id)).toBe(true);
  const mine = players.find((player: { userId: string }) => player.userId === user.id);
  expect(mine).toMatchObject({ bestScore: 0, rating: 1000 });
});

dbTest("my matches lists participations newest first", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  const created = await call("POST", "/api/games/paper/matches", {
    token: user.token,
    headers: { "idempotency-key": "list-key" },
  });
  expect(created.statusCode).toBe(201);
  const list = await call("GET", "/api/games/paper/me/matches", { token: user.token });
  expect(list.statusCode).toBe(200);
  expect(list.headers["cache-control"]).toBe("no-store");
  const hugePage = await call("GET", "/api/games/paper/me/matches?page=1e12", {
    token: user.token,
  });
  expect(hugePage.statusCode).toBe(200);
  const body = list.json();
  expect(body.total).toBeGreaterThanOrEqual(1);
  expect(body.matches[0]?.id).toBe(created.json().id);
  expect(body.matches[0]?.participants).toHaveLength(2);
  const anonymous = await call("GET", "/api/games/paper/me/matches");
  expect(anonymous.statusCode).toBe(401);
});

dbTest("entry state exposes only the current user's unfinished initiated match", async () => {
  const initiator = await registerUser();
  const opponent = await registerUser();
  await uploadOfficialBot(initiator.token);
  await uploadOfficialBot(opponent.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "5000.000000" })
    .where(
      and(
        eq(gameEntries.gameId, "paper"),
        notInArray(gameEntries.userId, [initiator.id, opponent.id]),
      ),
    );
  const created = await call("POST", "/api/games/paper/matches", {
    token: initiator.token,
    headers: { "idempotency-key": "active-entry" },
  });
  expect(created.statusCode).toBe(201);
  const id: string = created.json().id;
  expect(created.json().participants[1].userId).toBe(opponent.id);
  const pending = await call("GET", "/api/games/paper/me", { token: initiator.token });
  expect(pending.json().activeMatch).toEqual({ id, status: "pending" });
  const passive = await call("GET", "/api/games/paper/me", { token: opponent.token });
  expect(passive.json().activeMatch).toBeNull();
  expect(passive.json().canMatch).toBe(true);
  await database.db.update(matches).set({ status: "running" }).where(eq(matches.id, id));
  const running = await call("GET", "/api/games/paper/me", { token: initiator.token });
  expect(running.json().activeMatch).toEqual({ id, status: "running" });
  for (const status of ["completed", "failed"] as const) {
    await database.db.update(matches).set({ status }).where(eq(matches.id, id));
    const terminal = await call("GET", "/api/games/paper/me", { token: initiator.token });
    expect(terminal.json().activeMatch).toBeNull();
  }
});

dbTest("uploading preserves rating and match statistics", async () => {
  const user = await registerUser();
  await uploadOfficialBot(user.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "1234.500000", matchesPlayed: 9, wins: 5 })
    .where(eq(gameEntries.userId, user.id));
  await uploadOfficialBot(user.token);
  const rows = await database.db.select().from(gameEntries).where(eq(gameEntries.userId, user.id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ rating: "1234.500000", matchesPlayed: 9, wins: 5 });
});

dbTest(
  "replays are public only for completed matches and stream the exact gzip without content encoding",
  async () => {
    const user = await registerUser();
    await uploadOfficialBot(user.token);
    const created = await call("POST", "/api/games/paper/matches", {
      token: user.token,
      headers: { "idempotency-key": "download-replay" },
    });
    const id: string = created.json().id;
    for (const status of ["pending", "running", "failed"] as const) {
      await database.db.update(matches).set({ status }).where(eq(matches.id, id));
      const unavailable = await call("GET", `/api/matches/${id}/replay`);
      expect(unavailable.statusCode).toBe(409);
      expect(unavailable.json().code).toBe("REPLAY_NOT_READY");
    }
    const bytes = gzipSync(JSON.stringify({ matchId: id }));
    const ref = {
      fileName: `${id}.json.gz`,
      formatVersion: 1 as const,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await database.db
      .update(matches)
      .set({ status: "completed", replayFile: ref })
      .where(eq(matches.id, id));
    expect((await call("GET", `/api/matches/${id}/replay`)).statusCode).toBe(404);
    await writeFile(join(replayDir, ref.fileName), bytes);
    const downloaded = await app.inject(`/api/matches/${id}/replay`);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.rawPayload).toEqual(bytes);
    expect(downloaded.headers["content-type"]).toBe("application/gzip");
    expect(downloaded.headers["content-encoding"]).toBeUndefined();
    expect(downloaded.headers["content-length"]).toBe(String(bytes.length));
    expect(downloaded.headers["content-disposition"]).toContain(ref.fileName);
    expect(downloaded.headers.etag).toBe(`"${ref.sha256}"`);
    expect((await call("GET", "/api/matches/not-a-uuid/replay")).statusCode).toBe(404);
    expect(
      (await call("GET", "/api/matches/00000000-0000-4000-8000-000000000000/replay")).statusCode,
    ).toBe(404);
    await database.db
      .update(matches)
      .set({ replayFile: { ...ref, fileName: "../secret.json.gz" } })
      .where(eq(matches.id, id));
    expect((await call("GET", `/api/matches/${id}/replay`)).statusCode).toBe(500);
    await database.db
      .update(matches)
      .set({ replayFile: { ...ref, bytes: ref.bytes + 1 } })
      .where(eq(matches.id, id));
    expect((await call("GET", `/api/matches/${id}/replay`)).statusCode).toBe(500);
    await database.db.update(matches).set({ replayFile: null }).where(eq(matches.id, id));
    expect((await call("GET", `/api/matches/${id}/replay`)).statusCode).toBe(503);
  },
);

async function uploadRoyaleBot(token: string): Promise<void> {
  const royale = registeredGames.find((game) => game.entry.id === "royale");
  if (!royale) throw new Error("royale game is not registered");
  const res = await call("PUT", "/api/games/royale/me/code", {
    body: await readFile(royale.officialBotUrl, "utf8"),
    token,
    headers: { "content-type": "text/plain" },
  });
  expect(res.statusCode).toBe(200);
}

dbTest("the royale arena seats the starter plus the top ratings", async () => {
  const starter = await registerUser();
  const first = await registerUser();
  const second = await registerUser();
  for (const user of [starter, first, second]) await uploadRoyaleBot(user.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "1030.000000" })
    .where(and(eq(gameEntries.gameId, "royale"), eq(gameEntries.userId, second.id)));

  const duel = await call("POST", "/api/games/royale/matches", {
    token: first.token,
    headers: { "idempotency-key": "royale-duel" },
  });
  expect(duel.statusCode).toBe(409);
  expect(duel.json().code).toBe("ARENA_GAME");

  const status = await call("GET", "/api/games/royale/arena");
  expect(status.statusCode).toBe(200);
  const lineup = status.json().lineup as Array<{ userId: string; official: boolean }>;
  // Anonymous viewers see the top-rated board; the official bot takes one
  // free seat when fewer than five players qualify.
  expect(lineup[0]!.userId).toBe(second.id);
  expect(lineup.filter((seat) => seat.official)).toHaveLength(1);
  expect(status.json().active).toBeNull();

  // A logged-in player with runnable code previews the lineup of their own run.
  const mine = await call("GET", "/api/games/royale/arena", { token: first.token });
  expect(mine.json().lineup[0].userId).toBe(first.id);

  // Starting requires runnable royale code of one's own.
  const codeless = await registerUser();
  const noCode = await call("POST", "/api/games/royale/arena", {
    token: codeless.token,
    headers: { "idempotency-key": "royale-nocode" },
  });
  expect(noCode.statusCode).toBe(409);
  expect(noCode.json().code).toBe("NO_CODE");
  const codelessView = await call("GET", "/api/games/royale/arena", {
    token: codeless.token,
  });
  expect(codelessView.json().lineup[0].userId).toBe(second.id);

  const royale = registeredGames.find((game) => game.entry.id === "royale")!;
  await database.db
    .update(gameEntries)
    .set({ botProtocolVersion: 99 })
    .where(and(eq(gameEntries.gameId, "royale"), eq(gameEntries.userId, starter.id)));
  const stale = await call("POST", "/api/games/royale/arena", {
    token: starter.token,
    headers: { "idempotency-key": "royale-stale" },
  });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().code).toBe("PROTOCOL_MISMATCH");
  await database.db
    .update(gameEntries)
    .set({ botProtocolVersion: royale.entry.botProtocolVersion })
    .where(and(eq(gameEntries.gameId, "royale"), eq(gameEntries.userId, starter.id)));

  const started = await call("POST", "/api/games/royale/arena", {
    token: starter.token,
    headers: { "idempotency-key": "royale-run" },
  });
  expect(started.statusCode).toBe(201);
  const run = started.json();
  expect(run.kind).toBe("arena");
  // The starter always plays the first seat, exactly once; the rest follow the
  // rating board without the starter.
  expect(run.participants.map((seat: { userId: string }) => seat.userId)).toEqual([
    starter.id,
    ...lineup
      .filter((seat) => !seat.official && seat.userId !== starter.id)
      .map((seat) => seat.userId),
    lineup.find((seat) => seat.official)!.userId,
  ]);

  const busy = await call("POST", "/api/games/royale/arena", {
    token: first.token,
    headers: { "idempotency-key": "royale-second" },
  });
  expect(busy.statusCode).toBe(409);
  expect(busy.json()).toMatchObject({ code: "ARENA_BUSY", matchId: run.id });
  const retried = await call("POST", "/api/games/royale/arena", {
    token: starter.token,
    headers: { "idempotency-key": "royale-run" },
  });
  expect(retried.statusCode).toBe(200);
  expect(retried.json().id).toBe(run.id);
  const during = await call("GET", "/api/games/royale/arena");
  expect(during.json().active.id).toBe(run.id);
  // Free the arena for the tests that follow.
  await database.db.update(matches).set({ status: "completed" }).where(eq(matches.id, run.id));
});

dbTest("a bottom-rated starter displaces only the fifth rating seat", async () => {
  await database.db
    .update(matches)
    .set({ status: "completed" })
    .where(
      and(
        eq(matches.gameId, "royale"),
        eq(matches.kind, "arena"),
        inArray(matches.status, ["pending", "running"]),
      ),
    );
  const starter = await registerUser();
  const ranked: TestUser[] = [];
  for (let index = 0; index < 5; index++) ranked.push(await registerUser());
  for (const user of [starter, ...ranked]) await uploadRoyaleBot(user.token);
  // Players left runnable by earlier tests must not claim rating seats here.
  await onlyRunnable([starter.id, ...ranked.map((user) => user.id)], "royale");
  for (const [index, user] of ranked.entries())
    await database.db
      .update(gameEntries)
      .set({ rating: (1050 - index * 10).toFixed(6) })
      .where(and(eq(gameEntries.gameId, "royale"), eq(gameEntries.userId, user.id)));

  const started = await call("POST", "/api/games/royale/arena", {
    token: starter.token,
    headers: { "idempotency-key": "royale-underdog" },
  });
  expect(started.statusCode).toBe(201);
  const participants = started.json().participants as Array<{
    userId: string;
    official: boolean;
  }>;
  expect(participants.map((seat) => seat.userId)).toEqual([
    starter.id,
    ranked[0]!.id,
    ranked[1]!.id,
    ranked[2]!.id,
    ranked[3]!.id,
  ]);
  expect(participants.some((seat) => seat.userId === ranked[4]!.id)).toBe(false);
  expect(participants.some((seat) => seat.official)).toBe(false);
  await database.db
    .update(matches)
    .set({ status: "completed" })
    .where(eq(matches.id, started.json().id));
});

dbTest("arena boards break rating ties with the tie-break game's rating", async () => {
  await database.db
    .update(matches)
    .set({ status: "completed" })
    .where(
      and(
        eq(matches.gameId, "royale"),
        eq(matches.kind, "arena"),
        inArray(matches.status, ["pending", "running"]),
      ),
    );
  const low = await registerUser();
  const high = await registerUser();
  for (const user of [low, high]) await uploadRoyaleBot(user.token);
  await onlyRunnable([low.id, high.id], "royale");
  // Same royale rating; only `high` holds a paper record, and a higher one.
  await uploadOfficialBot(high.token);
  await database.db
    .update(gameEntries)
    .set({ rating: "1100.000000" })
    .where(and(eq(gameEntries.gameId, "paper"), eq(gameEntries.userId, high.id)));

  const status = await call("GET", "/api/games/royale/arena");
  const lineup = status.json().lineup as Array<{ userId: string; official: boolean }>;
  expect(lineup[0]!.userId).toBe(high.id);
  expect(lineup[1]!.userId).toBe(low.id);
  // The leaderboard shares the ordering: same arena rating, paper rating decides.
  const board = await call("GET", "/api/games/royale/leaderboard");
  const players = board.json().players as Array<{ userId: string }>;
  expect(players.findIndex((p) => p.userId === high.id)).toBeLessThan(
    players.findIndex((p) => p.userId === low.id),
  );
});
