import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * The product's own predefined High Impact News list (doc 02 "Fundamental / event
 * analysis"), the only news/fundamental condition Systems can use (doc 04 §2
 * HIGH_IMPACT_NEWS). Populated by Part J's ingestion pipeline; the schema lives here since
 * `worker` (condition evaluation, doc 04 §17: 60s monitoring cycle) and `api` (Chat's "show
 * the currently classified High Impact events" requirement, doc 02) both read it.
 *
 * `impactLevel` is kept as free text rather than a pgEnum because the exact classification
 * values are Part J's domain decision, not something Part A should lock in.
 *
 * ADDED per Part D/J's real-ingestion review (schema gap #1):
 *  - `source`: which upstream provider this event came from (BLS/FRED/Fed/SEC EDGAR — doc 01
 *    §4's four fundamental data sources). Free text, same reasoning as `impactLevel` above —
 *    confirmed against the real `packages/data-layer/src/fundamental/source-client.ts`, which
 *    types `sourceName: FundamentalEvent["source"]`, so this column's name/shape matches what
 *    the ingestion layer already expects.
 *  - `classificationListVersion`: which version of the product's own predefined HIN list
 *    (doc 02) this event was classified against. Plain integer, not a FK — no separate
 *    "HIN classification versions" table was requested, so this is just a version marker,
 *    mirroring `capability_registry.version`'s convention without that table's full
 *    versioned-registry machinery.
 *  - `sourceEventId` + the `(source, source_event_id)` unique constraint: the actual dedup
 *    mechanism for "re-running ingestion doesn't create duplicate rows." NOT explicitly named
 *    in the request — this is the one judgment call in this change, flagged prominently
 *    rather than silently added. Reasoning: deduping on the `event` text field alone is
 *    fragile (whitespace/formatting drift between runs of the same job), so this assumes
 *    each of BLS/FRED/Fed/SEC EDGAR's client responses carries (or can be made to carry) a
 *    native identifier for a given release/filing/event. Checked
 *    `packages/data-layer/src/fundamental/source-client.ts` — it's shared fetch plumbing and
 *    confirms the `source` field shape, but doesn't show `FundamentalEvent`'s full shape, so
 *    it doesn't confirm or rule out a native ID field. **`packages/data-layer/src/types.ts`
 *    (FundamentalEvent's definition) is the file that would settle this** — if it already has
 *    a native id field under a different name, rename this column to match.
 */
export const highImpactNewsEvents = pgTable(
  "high_impact_news_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event: text("event").notNull(),
    eventTimestamp: timestamp("event_timestamp", { withTimezone: true }).notNull(),
    country: text("country").notNull(),
    eventType: text("event_type").notNull(),
    impactLevel: text("impact_level").notNull(),
    sourceUrl: text("source_url"),
    source: text("source").notNull(),
    classificationListVersion: integer("classification_list_version").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventTimestampIdx: index("high_impact_news_events_event_timestamp_idx").on(
      table.eventTimestamp,
    ),
    sourceEventUnique: unique("high_impact_news_events_source_source_event_id_unique").on(
      table.source,
      table.sourceEventId,
    ),
  }),
);

/**
 * Broader (non-HIN) fundamental events Chat-side analysis needs (doc 01 §2 "Fundamental
 * Analysis", doc 02 "Fundamental / event analysis") — e.g. "What upcoming events could affect
 * my holdings?" isn't limited to only High-Impact-classified events; the AI's broader
 * fundamental-analysis responses need the full event stream, not just the subset that clears
 * the HIN bar. Schema gap #2 from Part D/J's review.
 *
 * Deliberately does NOT have `impactLevel`/`classificationListVersion` — those are HIN
 * classification concerns (doc 02's predefined HIN list only applies to the
 * HIGH_IMPACT_NEWS System condition, doc 04 §2); this table is the unclassified/general
 * event feed underneath that classification, not a duplicate of it.
 *
 * `description`/`sourceUrl` mirror `high_impact_news_events`'s `event`/`source_url` fields —
 * same naming as that table's analogous columns for consistency, using the "description"
 * wording from the request rather than "event" since this table isn't itself an "event" in
 * the HIN-classified sense.
 *
 * Same `sourceEventId` dedup judgment call as `high_impact_news_events` above — same flag,
 * same need for confirmation against `packages/data-layer/src/types.ts`.
 */
export const fundamentalEvents = pgTable(
  "fundamental_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    eventTimestamp: timestamp("event_timestamp", { withTimezone: true }).notNull(),
    country: text("country").notNull(),
    description: text("description").notNull(),
    sourceUrl: text("source_url"),
    sourceEventId: text("source_event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventTimestampIdx: index("fundamental_events_event_timestamp_idx").on(table.eventTimestamp),
    sourceEventUnique: unique("fundamental_events_source_source_event_id_unique").on(
      table.source,
      table.sourceEventId,
    ),
  }),
);
