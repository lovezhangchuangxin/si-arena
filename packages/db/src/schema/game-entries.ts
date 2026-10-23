import { desc } from "drizzle-orm";
import {
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const gameEntries = pgTable(
  "game_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: text("game_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceCode: text("source_code").notNull(),
    sourceBytes: integer("source_bytes").notNull(),
    botProtocolVersion: integer("bot_protocol_version").notNull(),
    rating: numeric("rating", { precision: 12, scale: 6 }).notNull().default("1000"),
    matchesPlayed: integer("matches_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    /** Arena games only: the sum of finishing ranks, for the average placement. */
    placementTotal: integer("placement_total").notNull().default(0),
    /** Solo games only: the best score across finished runs. */
    bestScore: integer("best_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("game_entries_game_user_key").on(table.gameId, table.userId),
    index("game_entries_game_rating_idx").on(table.gameId, desc(table.rating), table.userId),
    index("game_entries_game_best_score_idx").on(table.gameId, desc(table.bestScore), table.userId),
  ],
);
