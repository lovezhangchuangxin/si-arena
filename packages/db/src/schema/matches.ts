import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  GameResult,
  JsonObject,
  MatchFailureReason,
  MatchKind,
  ResourceLimits,
} from "@si-arena/protocol";
import { users } from "./users";

/** Written by the worker at settlement; only completed rows expose their file publicly. */
export interface ReplayFileRef {
  fileName: string;
  formatVersion: 1;
  bytes: number;
  sha256: string;
}

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: text("game_id").notNull(),
    release: text("release").notNull(),
    config: jsonb("config").$type<JsonObject>().notNull(),
    resolvedLimits: jsonb("resolved_limits").$type<ResourceLimits>().notNull(),
    botProtocolVersion: integer("bot_protocol_version").notNull(),
    seed: bigint("seed", { mode: "number" }).notNull(),
    initiatorId: uuid("initiator_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").$type<MatchKind>().notNull().default("ranked"),
    status: text("status").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    executionId: uuid("execution_id"),
    result: jsonb("result").$type<GameResult>(),
    replayFile: jsonb("replay_file").$type<ReplayFileRef>(),
    failureReason: text("failure_reason").$type<MatchFailureReason>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("matches_initiator_idempotency_key").on(table.initiatorId, table.idempotencyKey),
    uniqueIndex("matches_initiator_active_key")
      .on(table.initiatorId, table.gameId)
      .where(sql`status IN ('pending', 'running')`),
    // One unfinished run per arena game, whoever started it.
    uniqueIndex("matches_arena_active_key")
      .on(table.gameId)
      .where(sql`kind = 'arena' AND status IN ('pending', 'running')`),
    index("matches_game_kind_created_idx").on(table.gameId, table.kind, table.createdAt),
    index("matches_status_created_idx").on(table.status, table.createdAt),
    index("matches_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`lease_expires_at IS NOT NULL`),
    uniqueIndex("matches_execution_id_key").on(table.executionId),
    check("matches_seed_range", sql`${table.seed} >= 0 AND ${table.seed} <= 4294967295`),
    check(
      "matches_status_values",
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`,
    ),
    check(
      "matches_kind_values",
      sql`${table.kind} IN ('ranked', 'practice', 'boss', 'arena', 'solo')`,
    ),
  ],
);
