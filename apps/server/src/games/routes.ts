import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  type BossRecord,
  type CannotMatchReason,
  type GameCatalogEntry,
  type GameMeResponse,
  isSoloGame,
} from "@si-arena/protocol";
import { requireSession } from "../auth/session";
import { gameEntries, matchParticipants, matches, users } from "@si-arena/db";
import { runnableEntry } from "../matches/create";
import { sendError } from "../http/errors";
import { parsePagination } from "../http/pagination";
import { gameCatalog } from "../games";
import { validatePlayerSource } from "./code";

const MAX_CODE_BYTES = Math.max(
  1024,
  ...[...gameCatalog.values()].map((entry) => entry.resolvedLimits.codeBytes),
);

function findGame(gameId: string): GameCatalogEntry | undefined {
  return gameCatalog.get(gameId);
}

const selfSeat = alias(matchParticipants, "self_seat");
const bossSeat = alias(matchParticipants, "boss_seat");
const tieBreakEntry = alias(gameEntries, "tie_break_entry");

async function bossRecord(
  db: NodePgDatabase,
  game: GameCatalogEntry,
  userId: string,
): Promise<BossRecord> {
  const [boss] = await db
    .select({ id: users.id })
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .where(and(runnableEntry(game), eq(users.boss, true)))
    .limit(1);
  const [tally] = await db
    .select({
      attempts: sql<string>`count(*)`,
      wins: sql<string>`count(*) filter (where ${selfSeat.rank} = 1 and ${bossSeat.rank} > 1)`,
    })
    .from(matches)
    .innerJoin(selfSeat, eq(selfSeat.matchId, matches.id))
    .innerJoin(bossSeat, and(eq(bossSeat.matchId, matches.id), eq(bossSeat.bossSnapshot, true)))
    .where(
      and(
        eq(matches.gameId, game.id),
        eq(matches.kind, "boss"),
        eq(matches.status, "completed"),
        eq(selfSeat.userId, userId),
      ),
    );
  return {
    available: boss !== undefined,
    attempts: Number(tally?.attempts ?? 0),
    wins: Number(tally?.wins ?? 0),
  };
}

/** Same ordering key as the leaderboard: rating, or best score for solo games. */
async function leaderboardRank(
  db: NodePgDatabase,
  game: GameCatalogEntry,
  entry: { rating: string; bestScore: number },
): Promise<number> {
  const ahead = isSoloGame(game)
    ? sql`${gameEntries.bestScore} > ${entry.bestScore}`
    : sql`${gameEntries.rating} > ${entry.rating}`;
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(gameEntries)
    .innerJoin(users, eq(gameEntries.userId, users.id))
    .where(
      and(eq(gameEntries.gameId, game.id), eq(users.official, false), eq(users.boss, false), ahead),
    );
  return Number(row?.count ?? 0) + 1;
}

function cannotMatchReason(
  entry: { botProtocolVersion: number; sourceBytes: number } | undefined,
  game: GameCatalogEntry,
): CannotMatchReason | null {
  if (entry === undefined) return "NO_CODE";
  if (entry.botProtocolVersion !== game.botProtocolVersion) return "PROTOCOL_MISMATCH";
  if (entry.sourceBytes > game.resolvedLimits.codeBytes) return "CODE_TOO_LARGE";
  return null;
}

export function gamesRoutes(db: NodePgDatabase): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    // Uploads must be valid UTF-8: the default plain-text parser silently replaces
    // invalid bytes with U+FFFD, which would store code that differs from what
    // the client actually sent.
    app.addContentTypeParser("text/plain", { parseAs: "buffer" }, (_request, body, done) => {
      try {
        done(null, new TextDecoder("utf-8", { fatal: true }).decode(body as Buffer));
      } catch {
        const error = new Error("Request body is not valid UTF-8 text") as Error & {
          statusCode: number;
        };
        error.statusCode = 400;
        done(error, undefined);
      }
    });

    app.get<{ Params: { gameId: string } }>("/api/games/:gameId/me", async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const game = findGame(request.params.gameId);
      if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
      const session = await requireSession(db, request, reply);
      if (session === null) return reply;
      const rows = await db
        .select()
        .from(gameEntries)
        .where(and(eq(gameEntries.gameId, game.id), eq(gameEntries.userId, session.userId)))
        .limit(1);
      const entry = rows[0];
      const reason = cannotMatchReason(entry, game);
      const [active] = await db
        .select({ id: matches.id, status: matches.status })
        .from(matches)
        .where(
          and(
            eq(matches.gameId, game.id),
            eq(matches.initiatorId, session.userId),
            inArray(matches.status, ["pending", "running"]),
          ),
        )
        .limit(1);
      const response: GameMeResponse = {
        boss: await bossRecord(db, game, session.userId),
        entry: {
          rank:
            entry === undefined || session.official ? null : await leaderboardRank(db, game, entry),
          placementTotal: entry?.placementTotal ?? 0,
          bestScore: entry?.bestScore ?? 0,
          rating: entry === undefined ? 1000 : Number(entry.rating),
          matchesPlayed: entry?.matchesPlayed ?? 0,
          wins: entry?.wins ?? 0,
          draws: entry?.draws ?? 0,
          losses: entry?.losses ?? 0,
        },
        code:
          entry === undefined
            ? null
            : {
                source: entry.sourceCode,
                sourceBytes: entry.sourceBytes,
                botProtocolVersion: entry.botProtocolVersion,
                updatedAt: entry.updatedAt.toISOString(),
              },
        canMatch: reason === null,
        cannotMatchReason: reason,
        activeMatch:
          active && (active.status === "pending" || active.status === "running")
            ? { id: active.id, status: active.status }
            : null,
      };
      return response;
    });

    app.put<{ Params: { gameId: string } }>(
      "/api/games/:gameId/me/code",
      { bodyLimit: MAX_CODE_BYTES },
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = findGame(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        if (typeof request.body !== "string") {
          return sendError(reply, 400, "VALIDATION_ERROR", "请求体必须是 text/plain 的源码文本");
        }
        const source = request.body;
        // An empty program parses cleanly but can never provide an entrypoint,
        // so an empty upload is rejected at the request level.
        if (source.length === 0) {
          return sendError(reply, 400, "VALIDATION_ERROR", "源码文本不能为空");
        }
        if (Buffer.byteLength(source, "utf8") > game.resolvedLimits.codeBytes) {
          return sendError(reply, 413, "BODY_TOO_LARGE", "源码超过当前发行的体积上限");
        }
        const validation = await validatePlayerSource(source, game.resolvedLimits);
        if (!validation.ok && validation.reason === "BUSY") {
          return sendError(reply, 429, "RATE_LIMITED", "校验服务繁忙，请稍后再试", 1);
        }
        if (!validation.ok) {
          return sendError(
            reply,
            400,
            "CODE_INVALID",
            "源码校验未通过：语法错误或包含不支持的语法",
          );
        }
        const sourceBytes = Buffer.byteLength(source, "utf8");
        // The catalog is the single in-memory source of releases, so validating and
        // writing against the same entry already satisfies the release-freeze check.
        const rows = await db
          .insert(gameEntries)
          .values({
            gameId: game.id,
            userId: session.userId,
            sourceCode: source,
            sourceBytes,
            botProtocolVersion: game.botProtocolVersion,
          })
          .onConflictDoUpdate({
            target: [gameEntries.gameId, gameEntries.userId],
            set: {
              sourceCode: source,
              sourceBytes,
              botProtocolVersion: game.botProtocolVersion,
              updatedAt: new Date(),
            },
          })
          .returning({
            sourceBytes: gameEntries.sourceBytes,
            botProtocolVersion: gameEntries.botProtocolVersion,
            updatedAt: gameEntries.updatedAt,
          });
        const row = rows[0];
        if (row === undefined) throw new Error("code upsert returned no row");
        return {
          sourceBytes: row.sourceBytes,
          botProtocolVersion: row.botProtocolVersion,
          updatedAt: row.updatedAt.toISOString(),
        };
      },
    );

    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/leaderboard",
      async (request, reply) => {
        const game = findGame(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const { page, limit, offset } = parsePagination(request.url);
        // Official and boss accounts play but never appear on the leaderboard.
        const ranked = and(
          eq(gameEntries.gameId, game.id),
          eq(users.official, false),
          eq(users.boss, false),
        );
        const arena = game.arena;
        const solo = isSoloGame(game);
        // Arena games additionally break display order by the tie-break game's
        // rating; solo games order by the best run score; ranks share on equal keys.
        const order =
          arena === undefined
            ? [
                ...(solo ? [desc(gameEntries.bestScore)] : [desc(gameEntries.rating)]),
                asc(gameEntries.userId),
              ]
            : [
                desc(gameEntries.rating),
                sql`coalesce(${tieBreakEntry.rating}, 1000) desc`,
                asc(gameEntries.userId),
              ];
        const totals = await db
          .select({ count: sql<string>`count(*)` })
          .from(gameEntries)
          .innerJoin(users, eq(gameEntries.userId, users.id))
          .where(ranked);
        const rows = await db
          .select({
            rank: sql<string>`rank() over (order by ${
              solo ? gameEntries.bestScore : gameEntries.rating
            } desc)`,
            userId: gameEntries.userId,
            username: users.normalizedUsername,
            official: users.official,
            rating: gameEntries.rating,
            matchesPlayed: gameEntries.matchesPlayed,
            wins: gameEntries.wins,
            draws: gameEntries.draws,
            losses: gameEntries.losses,
            placementTotal: gameEntries.placementTotal,
            bestScore: gameEntries.bestScore,
          })
          .from(gameEntries)
          .innerJoin(users, eq(gameEntries.userId, users.id))
          .leftJoin(
            tieBreakEntry,
            and(
              eq(tieBreakEntry.userId, gameEntries.userId),
              eq(tieBreakEntry.gameId, arena?.tieBreakGameId ?? ""),
            ),
          )
          .where(ranked)
          .orderBy(...order)
          .limit(limit)
          .offset(offset);
        return {
          total: Number(totals[0]?.count ?? 0),
          page,
          limit,
          players: rows.map((row) => ({
            rank: Number(row.rank),
            userId: row.userId,
            username: row.username,
            official: row.official,
            rating: Number(row.rating),
            matchesPlayed: row.matchesPlayed,
            wins: row.wins,
            draws: row.draws,
            losses: row.losses,
            placementTotal: row.placementTotal,
            bestScore: row.bestScore,
          })),
        };
      },
    );
  };
}
