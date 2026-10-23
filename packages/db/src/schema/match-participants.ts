import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { users } from "./users";

export const matchParticipants = pgTable(
  "match_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    slot: integer("slot").notNull(),
    nameSnapshot: text("name_snapshot").notNull(),
    officialSnapshot: boolean("official_snapshot").notNull(),
    bossSnapshot: boolean("boss_snapshot").notNull().default(false),
    rank: integer("rank"),
    /** In-game score from the settled result. */
    score: integer("score"),
    ratingBefore: numeric("rating_before", { precision: 12, scale: 6 }),
    ratingAfter: numeric("rating_after", { precision: 12, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("match_participants_match_user_key").on(table.matchId, table.userId),
    uniqueIndex("match_participants_match_slot_key").on(table.matchId, table.slot),
    index("match_participants_user_match_idx").on(table.userId, table.matchId),
  ],
);
