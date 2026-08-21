import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Database } from "@oplier/db";
import { highImpactNewsEvents } from "@oplier/db";
import type { HINEvent, NewsRepository } from "@oplier/data-layer";

/**
 * Real Drizzle-backed `NewsRepository`, backing the engine's HIGH_IMPACT_NEWS condition on its
 * locked 60s cadence.
 *
 * The worker only genuinely needs `getUpcoming` (that is all
 * `HinNewsDataProviderAdapter.hasUpcomingHighImpactEvent` calls); the other three are implemented
 * because the interface requires them and the ingestion CLIs in `@oplier/data-layer` can then run
 * against real storage instead of the in-memory store, which currently loses everything on restart.
 *
 * ⚠ NOT YET RUN AGAINST A LIVE DATABASE.
 *
 * ── TWO REAL SCHEMA MISMATCHES, handled explicitly rather than papered over ──
 *
 * 1. `classificationListVersion`: `HINEvent` types it as a STRING (the curated list's own version,
 *    e.g. `"2026-08-17.v1"`), but `high_impact_news_events.classification_list_version` is an
 *    `integer`. They cannot round-trip. This maps by extracting the trailing revision number
 *    (`v1` -> `1`), which preserves ordering between list revisions but **loses the date portion**.
 *    Recommend to Part B: change that column to `text`. Encoding the full `2026-08-17.v1` as an
 *    integer is not an option — `2026081701` overflows int4's 2,147,483,647 ceiling, so there is no
 *    lossless numeric encoding available.
 *
 * 2. `sourceEventId`: NOT NULL in the schema (it plus `source` forms the unique key that makes
 *    re-ingestion idempotent), but absent from `HINEvent` entirely. `packages/db/src/schema/news.ts`
 *    flags this itself and names `data-layer/src/types.ts` as the file that would settle it — it
 *    doesn't have such a field. Derived here as a stable hash of the natural key the data layer's own
 *    in-memory repository dedupes on (event + eventTimestamp + country), so idempotent re-ingestion
 *    still works as intended. Once a source's native identifier is available, use it directly and
 *    delete this derivation.
 */

/** See mismatch #1. Extracts the revision number from a version string like "2026-08-17.v1". */
export function toClassificationVersionInt(version: string): number {
  const match = /v(\d+)\s*$/i.exec(version.trim());
  return match ? Number(match[1]) : 0;
}

/** See mismatch #2. Stable, deterministic surrogate for a missing native source id. */
export function deriveSourceEventId(event: Pick<HINEvent, "event" | "eventTimestamp" | "country">): string {
  const naturalKey = `${event.event}|${event.eventTimestamp.toISOString()}|${event.country}`;
  return createHash("sha256").update(naturalKey).digest("hex").slice(0, 32);
}

type NewsRow = typeof highImpactNewsEvents.$inferSelect;

function mapEvent(row: NewsRow): HINEvent {
  return {
    id: row.id,
    event: row.event,
    eventTimestamp: row.eventTimestamp,
    country: row.country,
    eventType: row.eventType,
    // `impact_level` is free text in the schema (deliberately — Part J owns the values), so this
    // narrows to the typed union. A row with an unexpected value is treated as LOW rather than
    // crashing the 60s news cycle for every System.
    impactLevel:
      row.impactLevel === "HIGH" || row.impactLevel === "MEDIUM" || row.impactLevel === "LOW"
        ? row.impactLevel
        : "LOW",
    sourceUrl: row.sourceUrl,
    source: row.source as HINEvent["source"],
    classificationListVersion: String(row.classificationListVersion),
  };
}

export class DrizzleNewsRepository implements NewsRepository {
  constructor(private readonly db: Database) {}

  async upsertEvents(events: HINEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.db
      .insert(highImpactNewsEvents)
      .values(
        events.map((e) => ({
          event: e.event,
          eventTimestamp: e.eventTimestamp,
          country: e.country,
          eventType: e.eventType,
          impactLevel: e.impactLevel,
          sourceUrl: e.sourceUrl,
          source: e.source,
          classificationListVersion: toClassificationVersionInt(e.classificationListVersion),
          sourceEventId: deriveSourceEventId(e),
        })),
      )
      // The natural-key unique constraint is what makes re-running an ingestion job safe. On
      // conflict, copy the incoming values via Postgres' `excluded` pseudo-table — a re-ingested
      // event may have a corrected timestamp or a reclassified impact level, and the stored row
      // should reflect the newer read.
      .onConflictDoUpdate({
        target: [highImpactNewsEvents.source, highImpactNewsEvents.sourceEventId],
        set: {
          event: sql`excluded.event`,
          eventTimestamp: sql`excluded.event_timestamp`,
          country: sql`excluded.country`,
          eventType: sql`excluded.event_type`,
          impactLevel: sql`excluded.impact_level`,
          sourceUrl: sql`excluded.source_url`,
          classificationListVersion: sql`excluded.classification_list_version`,
        },
      });
  }

  async getEvents(range?: { from: Date; to: Date }): Promise<HINEvent[]> {
    const rows = range
      ? await this.db
          .select()
          .from(highImpactNewsEvents)
          .where(
            and(
              gte(highImpactNewsEvents.eventTimestamp, range.from),
              lte(highImpactNewsEvents.eventTimestamp, range.to),
            ),
          )
          .orderBy(asc(highImpactNewsEvents.eventTimestamp))
      : await this.db.select().from(highImpactNewsEvents).orderBy(asc(highImpactNewsEvents.eventTimestamp));
    return rows.map(mapEvent);
  }

  async getEventById(id: string): Promise<HINEvent | null> {
    const [row] = await this.db
      .select()
      .from(highImpactNewsEvents)
      .where(eq(highImpactNewsEvents.id, id))
      .limit(1);
    return row ? mapEvent(row) : null;
  }

  async getUpcoming(withinHours: number): Promise<HINEvent[]> {
    // The hot path: called every 60s per the locked HIN cadence. Bounded on both sides — an event
    // already in the past is not "upcoming", and `high_impact_news_events_event_timestamp_idx`
    // covers this range scan.
    const now = new Date();
    const until = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
    const rows = await this.db
      .select()
      .from(highImpactNewsEvents)
      .where(
        and(
          gte(highImpactNewsEvents.eventTimestamp, now),
          lte(highImpactNewsEvents.eventTimestamp, until),
        ),
      )
      .orderBy(asc(highImpactNewsEvents.eventTimestamp));
    return rows.map(mapEvent);
  }
}
