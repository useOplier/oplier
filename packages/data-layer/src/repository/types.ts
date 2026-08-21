// =============================================================================
// src/repository/types.ts — persistence port, mirrors ENGINE_CONTRACT.md §2's
// repository seam pattern (SystemRepository / in-memory + drizzle-adapter).
//
// Same rationale as Part C's: no live Postgres/Supabase connection exists in
// this build environment, so this is the only way to actually *run* the test
// suite against real logic rather than submit untested code. The Drizzle
// adapter maps 1:1 onto Part B's `packages/db` schema (assets.ts / prices.ts
// / news.ts in full_schema.txt) and is a reference sketch, not exercised
// against a live database — same caveat Part C raised for its own
// drizzle-adapter.ts.
// =============================================================================

import type { HINEvent, PricePoint } from "../types.js";

export interface LatestPriceRow {
  assetId: string;
  price: number;
  source: "pyth";
  observedAt: Date;
  isStale: boolean;
  updatedAt: Date;
}

export interface PriceRepository {
  getLatestPrice(assetId: string): Promise<LatestPriceRow | null>;
  upsertLatestPrice(row: LatestPriceRow): Promise<void>;
  appendHistory(point: PricePoint): Promise<void>;
  getHistory(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]>;
}

export interface NewsRepository {
  /** Upsert-by-natural-key (event + eventTimestamp + country) so re-ingestion is idempotent. */
  upsertEvents(events: HINEvent[]): Promise<void>;
  getEvents(range?: { from: Date; to: Date }): Promise<HINEvent[]>;
  getEventById(id: string): Promise<HINEvent | null>;
  /** Events with `eventTimestamp` between now and now+withinHours. */
  getUpcoming(withinHours: number): Promise<HINEvent[]>;
}
