import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { MatchDetail, MatchStatus, MatchSummary } from "@si-arena/protocol";
import { matchParticipants, matches } from "@si-arena/db";

export type MatchRow = typeof matches.$inferSelect;

async function participantsOf(
  db: NodePgDatabase,
  matchId: string,
): Promise<MatchSummary["participants"]> {
  const rows = await db
    .select()
    .from(matchParticipants)
    .where(eq(matchParticipants.matchId, matchId))
    .orderBy(matchParticipants.slot);
  return rows.map((row) => ({
    userId: row.userId,
    username: row.nameSnapshot,
    official: row.officialSnapshot,
    boss: row.bossSnapshot,
    slot: row.slot,
    ...(row.rank !== null ? { rank: row.rank } : {}),
    ...(row.score !== null ? { score: row.score } : {}),
    ...(row.ratingBefore !== null ? { ratingBefore: Number(row.ratingBefore) } : {}),
    ...(row.ratingAfter !== null ? { ratingAfter: Number(row.ratingAfter) } : {}),
  }));
}

export async function buildMatchDetail(db: NodePgDatabase, row: MatchRow): Promise<MatchDetail> {
  const participants = await participantsOf(db, row.id);
  return {
    id: row.id,
    gameId: row.gameId,
    kind: row.kind,
    status: row.status as MatchStatus,
    createdAt: row.createdAt.toISOString(),
    participants,
    release: row.release,
    seed: row.seed,
    initiatorId: row.initiatorId,
    ...(row.result !== null ? { result: row.result } : {}),
    ...(row.failureReason !== null ? { failureReason: row.failureReason } : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}
