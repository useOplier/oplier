// =============================================================================
// src/repository/drizzle-adapter.ts — reference sketch of the real Part A/B
// schema mapping (assetPrices, assetPriceHistory, highImpactNewsEvents from
// full_schema.txt), mirroring ENGINE_CONTRACT.md §2's own drizzle-adapter.ts
// caveat exactly:
//
// EXCLUDED FROM TYPECHECK (see tsconfig.json `exclude`) and NOT EXERCISED
// AGAINST A LIVE DATABASE. `@oplier/db` isn't installable in this sandbox
// (no network, no workspace link to Part B's actual package). Part I's first
// job with this file is the same caveat Part B raised for its own work
// (API_CONTRACT.md §0) and Part C raised for its drizzle-adapter.ts: run it
// for real, against Part B's actual `packages/db` exports, before trusting
// it. Get the real `packages/db` files from Part B's chat per the master
// plan's standing rule (Part B is canonical maintainer), not from this file's
// guesses about column names.
//
// The mapping below follows full_schema.txt's `prices.ts` and `news.ts`
// field-for-field as of the version attached to this build. If Part B's
// live schema has since diverged, this needs a diff against the current
// `packages/db` before use — flag any mismatch back to the manager thread
// rather than silently reconciling it here.
// =============================================================================

/*
import { eq, and, gte, lte, asc } from "drizzle-orm";
import { db } from "@oplier/db"; // Part B's actual client export
import { assetPrices, assetPriceHistory, highImpactNewsEvents } from "@oplier/db/schema";
import type { HINEvent, PricePoint } from "../types.js";
import type { LatestPriceRow, NewsRepository, PriceRepository } from "./types.js";

export class DrizzlePriceRepository implements PriceRepository {
  async getLatestPrice(assetId: string): Promise<LatestPriceRow | null> {
    const [row] = await db
      .select()
      .from(assetPrices)
      .where(eq(assetPrices.assetId, assetId))
      .limit(1);
    if (!row) return null;
    return {
      assetId: row.assetId,
      price: Number(row.price),
      source: "pyth",
      observedAt: row.observedAt,
      isStale: row.isStale,
      updatedAt: row.updatedAt,
    };
  }

  async upsertLatestPrice(row: LatestPriceRow): Promise<void> {
    await db
      .insert(assetPrices)
      .values({
        assetId: row.assetId,
        price: row.price.toString(),
        source: row.source,
        observedAt: row.observedAt,
        isStale: row.isStale,
      })
      .onConflictDoUpdate({
        target: assetPrices.assetId,
        set: {
          price: row.price.toString(),
          observedAt: row.observedAt,
          isStale: row.isStale,
          updatedAt: new Date(),
        },
      });
  }

  async appendHistory(point: PricePoint): Promise<void> {
    await db.insert(assetPriceHistory).values({
      assetId: point.assetId,
      price: point.price.toString(),
      source: point.source,
      observedAt: point.observedAt,
    });
  }

  async getHistory(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]> {
    const rows = await db
      .select()
      .from(assetPriceHistory)
      .where(
        and(
          eq(assetPriceHistory.assetId, assetId),
          gte(assetPriceHistory.observedAt, range.from),
          lte(assetPriceHistory.observedAt, range.to),
        ),
      )
      .orderBy(asc(assetPriceHistory.observedAt));
    return rows.map((r) => ({
      assetId: r.assetId,
      price: Number(r.price),
      observedAt: r.observedAt,
      source: "pyth" as const,
    }));
  }
}

export class DrizzleNewsRepository implements NewsRepository {
  async upsertEvents(events: HINEvent[]): Promise<void> {
    // NOTE: highImpactNewsEvents has no natural-key unique constraint in
    // full_schema.txt as attached — this insert will need an
    // onConflictDoUpdate target once Part B adds one (event + eventTimestamp
    // + country is the natural key used by InMemoryNewsRepository). Flagging
    // this back to the manager thread / Part B rather than guessing a
    // migration here — Part D+J does not own packages/db migrations.
    for (const e of events) {
      await db.insert(highImpactNewsEvents).values({
        event: e.event,
        eventTimestamp: e.eventTimestamp,
        country: e.country,
        eventType: e.eventType,
        impactLevel: e.impactLevel,
        sourceUrl: e.sourceUrl,
      });
    }
  }

  async getEvents(range?: { from: Date; to: Date }): Promise<HINEvent[]> {
    const query = db.select().from(highImpactNewsEvents);
    const rows = range
      ? await query.where(
          and(
            gte(highImpactNewsEvents.eventTimestamp, range.from),
            lte(highImpactNewsEvents.eventTimestamp, range.to),
          ),
        )
      : await query;
    return rows.map(rowToHinEvent);
  }

  async getEventById(id: string): Promise<HINEvent | null> {
    const [row] = await db
      .select()
      .from(highImpactNewsEvents)
      .where(eq(highImpactNewsEvents.id, id))
      .limit(1);
    return row ? rowToHinEvent(row) : null;
  }

  async getUpcoming(withinHours: number): Promise<HINEvent[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinHours * 60 * 60 * 1000);
    return this.getEvents({ from: now, to: horizon });
  }
}

function rowToHinEvent(row: typeof highImpactNewsEvents.$inferSelect): HINEvent {
  return {
    id: row.id,
    event: row.event,
    eventTimestamp: row.eventTimestamp,
    country: row.country,
    eventType: row.eventType,
    impactLevel: row.impactLevel as HINEvent["impactLevel"],
    sourceUrl: row.sourceUrl,
    source: "BLS", // placeholder — full_schema.txt's news.ts has no source-attribution
                    // column; see DATA_LAYER_CONTRACT.md §4 flag re: adding one.
    classificationListVersion: "unknown", // same flag — not a column in the current schema.
  };
}
*/

export {};
