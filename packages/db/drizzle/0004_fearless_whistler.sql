ALTER TABLE "matches" DROP CONSTRAINT "matches_kind_values";--> statement-breakpoint
ALTER TABLE "game_entries" ADD COLUMN "best_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "score" integer;--> statement-breakpoint
CREATE INDEX "game_entries_game_best_score_idx" ON "game_entries" USING btree ("game_id","best_score" desc,"user_id");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_kind_values" CHECK ("matches"."kind" IN ('ranked', 'practice', 'boss', 'arena', 'solo'));