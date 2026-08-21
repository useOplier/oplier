-- Part D/J schema-gap fix: adds source/classification-version/dedup tracking to
-- high_impact_news_events, and a new fundamental_events table for the broader (non-HIN)
-- event stream doc 01 §2/doc 02's Chat-side fundamental analysis needs.
--
-- Generated for real via `drizzle-kit generate` against the actual schema/*.ts files and a
-- reconstructed baseline snapshot of 0000_init.sql (0000 predates this project using tracked
-- migrations, so it had no snapshot file — one was regenerated from the original pre-this-
-- change schema and grafted in as meta/0000_snapshot.json before generating this file, so the
-- diff below is a real tool-computed diff, not hand-authored).
--
-- ⚠️ OPERATIONAL WARNING before running this against the live DB: the three
-- `ALTER TABLE "high_impact_news_events" ADD COLUMN ... NOT NULL` statements below have no
-- DEFAULT. If `high_impact_news_events` already has any rows, these will fail outright
-- (Postgres rejects adding a NOT NULL column with no default to a non-empty table). Two ways
-- to handle that, if it turns out the table isn't actually empty:
--   1. If the existing rows are disposable test/seed data: TRUNCATE the table first, then run
--      this migration, then let ingestion repopulate it.
--   2. If the existing rows must be kept: add each column as nullable first, run a backfill
--      UPDATE to populate `source`/`classification_list_version`/`source_event_id` for the
--      existing rows from whatever your ingestion history knows, THEN run a follow-up
--      migration adding the NOT NULL constraints. Don't run the statements below as-is
--      against a non-empty table without doing one of these first.
-- `fundamental_events` is a brand-new table, so it carries no such risk.

CREATE TABLE IF NOT EXISTS "fundamental_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"country" text NOT NULL,
	"description" text NOT NULL,
	"source_url" text,
	"source_event_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamental_events_source_source_event_id_unique" UNIQUE("source","source_event_id")
);
--> statement-breakpoint
ALTER TABLE "high_impact_news_events" ADD COLUMN "source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "high_impact_news_events" ADD COLUMN "classification_list_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "high_impact_news_events" ADD COLUMN "source_event_id" text NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fundamental_events_event_timestamp_idx" ON "fundamental_events" USING btree ("event_timestamp");--> statement-breakpoint
ALTER TABLE "high_impact_news_events" ADD CONSTRAINT "high_impact_news_events_source_source_event_id_unique" UNIQUE("source","source_event_id");
