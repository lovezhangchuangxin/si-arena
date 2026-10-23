import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { requireSession } from "../auth/session";
import { matchParticipants, matches } from "@si-arena/db";
import { sendError } from "../http/errors";
import { parsePagination } from "../http/pagination";
import { gameCatalog } from "../games";
import { isSoloGame } from "@si-arena/protocol";
import {
  createDuel,
  createSoloRun,
  ENTRY_NOT_RUNNABLE_MESSAGES,
  entryNotRunnableReason,
  loadGameEntry,
  MatchRequestError,
  type MatchIntent,
} from "./create";
import { buildMatchDetail } from "./detail";
import { idempotencyKeyOf, replyToDuplicate, UUID_PATTERN } from "./requests";
import { sendReplay } from "./replay";

/** Parses the optional CreateMatchRequest body; null means it is malformed. */
function matchIntentOf(body: unknown): MatchIntent | null {
  if (body === undefined || body === null || body === "") return { type: "matchmaking" };
  if (typeof body !== "object" || Array.isArray(body)) return null;
  const { opponentId, boss, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (opponentId !== undefined && boss !== undefined) return null;
  if (boss !== undefined) return boss === true ? { type: "boss" } : null;
  if (opponentId !== undefined)
    return typeof opponentId === "string" && UUID_PATTERN.test(opponentId)
      ? { type: "challenge", opponentId: opponentId.toLowerCase() }
      : null;
  return { type: "matchmaking" };
}

export function matchesRoutes(db: NodePgDatabase, replaysDir?: string): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.post<{ Params: { gameId: string } }>(
      "/api/games/:gameId/matches",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = gameCatalog.get(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        const idempotencyKey = idempotencyKeyOf(request);
        if (idempotencyKey === null) {
          return sendError(
            reply,
            400,
            "VALIDATION_ERROR",
            "Idempotency-Key 请求头缺失或长度不合法",
          );
        }

        const existingRows = await db
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.initiatorId, session.userId),
              eq(matches.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        const existing = existingRows[0];
        if (existing !== undefined) {
          if (existing.gameId !== game.id) {
            return sendError(reply, 409, "IDEMPOTENCY_MISMATCH", "该幂等键已用于不同的请求参数");
          }
          return reply.status(200).send(await buildMatchDetail(db, existing));
        }

        if (game.arena !== undefined)
          return sendError(reply, 409, "ARENA_GAME", "该游戏只能通过竞技场开局");
        const intent = matchIntentOf(request.body);
        if (intent === null)
          return sendError(reply, 400, "VALIDATION_ERROR", "请求体只能包含 opponentId 或 boss");

        const entry = await loadGameEntry(db, game.id, session.userId);
        if (entry === undefined)
          return sendError(reply, 409, "NO_CODE", ENTRY_NOT_RUNNABLE_MESSAGES.NO_CODE);
        const problem = entryNotRunnableReason(entry, game);
        if (problem !== null)
          return sendError(reply, 409, problem, ENTRY_NOT_RUNNABLE_MESSAGES[problem]);

        try {
          const initiator = {
            userId: session.userId,
            username: session.username,
            official: session.official,
            boss: false,
          };
          const row = isSoloGame(game)
            ? intent.type === "matchmaking"
              ? await createSoloRun(db, game, { initiator, idempotencyKey })
              : null
            : await createDuel(db, game, {
                initiator,
                initiatorRating: Number(entry.rating),
                idempotencyKey,
                intent,
              });
          if (row === null)
            return sendError(reply, 400, "VALIDATION_ERROR", "单人游戏不接收对手或 Boss 参数");
          return reply.status(201).send(await buildMatchDetail(db, row));
        } catch (error) {
          if (error instanceof MatchRequestError)
            return sendError(reply, error.status, error.code, error.message);
          const handled = await replyToDuplicate(db, reply, error, {
            initiatorId: session.userId,
            idempotencyKey,
            game,
          });
          if (handled !== null) return handled;
          throw error;
        }
      },
    );

    app.get<{ Params: { gameId: string } }>(
      "/api/games/:gameId/me/matches",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const game = gameCatalog.get(request.params.gameId);
        if (!game) return sendError(reply, 404, "GAME_NOT_FOUND", "游戏不存在");
        const session = await requireSession(db, request, reply);
        if (session === null) return reply;
        const { page, limit, offset } = parsePagination(request.url);
        const totals = await db
          .select({ count: sql<string>`count(*)` })
          .from(matches)
          .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
          .where(and(eq(matches.gameId, game.id), eq(matchParticipants.userId, session.userId)));
        const rows = await db
          .select({ match: matches })
          .from(matches)
          .innerJoin(matchParticipants, eq(matchParticipants.matchId, matches.id))
          .where(and(eq(matches.gameId, game.id), eq(matchParticipants.userId, session.userId)))
          .orderBy(desc(matches.createdAt), desc(matches.id))
          .limit(limit)
          .offset(offset);
        const summaries = await Promise.all(rows.map((row) => buildMatchDetail(db, row.match)));
        return { total: Number(totals[0]?.count ?? 0), page, limit, matches: summaries };
      },
    );

    app.get<{ Params: { matchId: string } }>(
      "/api/matches/:matchId/replay",
      async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const matchId = request.params.matchId;
        if (!UUID_PATTERN.test(matchId))
          return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
        const [row] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
        if (!row) return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
        if (row.status !== "completed")
          return sendError(reply, 409, "REPLAY_NOT_READY", "比赛尚未完成，没有可用回放");
        if (!row.replayFile || !replaysDir)
          return sendError(reply, 503, "REPLAY_UNAVAILABLE", "回放暂时不可用，请稍后重试");
        return sendReplay(reply, replaysDir, row.id, row.replayFile);
      },
    );

    app.get<{ Params: { matchId: string } }>("/api/matches/:matchId", async (request, reply) => {
      const matchId = request.params.matchId;
      if (!UUID_PATTERN.test(matchId)) {
        return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
      }
      const rows = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
      const row = rows[0];
      if (row === undefined) return sendError(reply, 404, "MATCH_NOT_FOUND", "比赛不存在");
      return buildMatchDetail(db, row);
    });
  };
}
