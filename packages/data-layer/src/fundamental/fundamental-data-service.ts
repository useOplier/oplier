// =============================================================================
// src/fundamental/fundamental-data-service.ts — Part J core deliverable.
// Implements `FundamentalDataService` (types.ts) for Part B's
// GET /high-impact-news endpoint and Part G's LLM #1 tools.
//
// Pure data retrieval + deterministic classification only (brief, "Out of
// scope: no LLM calls, no interpretation/analysis"). `getUpcomingEvents` /
// `getEventDetail` serve Chat-side fundamental analysis (doc 01 §2, doc 02),
// which is broader than HIN — they return ALL ingested events, HIN-tagged or
// not, leaving interpretation to LLM #1. `getHighImpactNewsList` is the
// narrower HIN-only view Systems and the pre-creation "show the user the
// HIN list" requirement (doc 02) actually need.
// =============================================================================

import { classifyForHin, HIN_CLASSIFICATION_LIST_VERSION } from "./hin-classification.js";
import type { EdgarClient } from "./edgar-client.js";
import type {
  FundamentalDataService,
  FundamentalEvent,
  HINEvent,
  SECFiling,
} from "../types.js";
import type { NewsRepository } from "../repository/types.js";

export interface FundamentalDataServiceDeps {
  newsRepository: NewsRepository;
  edgarClient: EdgarClient;
  /** All non-EDGAR events (BLS/FRED/Fed), kept separately since EDGAR filings are per-ticker, not date-windowed the same way. */
  fundamentalEventStore: FundamentalEventStore;
}

/**
 * Storage seam for the broader (non-EDGAR, non-HIN-filtered)
 * `FundamentalEvent` set (BLS/FRED/Fed ingestion output). Kept distinct from
 * `NewsRepository` (which stores only HIN-classified rows matching
 * `high_impact_news_events`'s schema) because doc 02's Chat-side scope is
 * broader than HIN — an ingested CPI print is a `FundamentalEvent` the
 * moment it's ingested, and becomes an `HINEvent` additionally once
 * `classifyForHin` matches it, per `IngestionPipeline` below. Not backed by
 * a dedicated table in full_schema.txt as attached — flagged in
 * DATA_LAYER_CONTRACT.md §4 as a schema gap Part A/B should add
 * (`fundamental_events`), with an in-memory implementation here in the
 * interim so the service is fully runnable today.
 */
export interface FundamentalEventStore {
  upsert(events: FundamentalEvent[]): Promise<void>;
  getInRange(range: { from: Date; to: Date }): Promise<FundamentalEvent[]>;
  getById(id: string): Promise<FundamentalEvent | null>;
}

export class InMemoryFundamentalEventStore implements FundamentalEventStore {
  private events = new Map<string, FundamentalEvent>();

  async upsert(events: FundamentalEvent[]): Promise<void> {
    for (const e of events) this.events.set(e.id, e);
  }

  async getInRange(range: { from: Date; to: Date }): Promise<FundamentalEvent[]> {
    return [...this.events.values()]
      .filter(
        (e) =>
          e.eventTimestamp.getTime() >= range.from.getTime() &&
          e.eventTimestamp.getTime() <= range.to.getTime(),
      )
      .sort((a, b) => a.eventTimestamp.getTime() - b.eventTimestamp.getTime());
  }

  async getById(id: string): Promise<FundamentalEvent | null> {
    return this.events.get(id) ?? null;
  }

  /** Test helper — not part of the interface. */
  _reset(): void {
    this.events.clear();
  }
}

export class FundamentalDataServiceImpl implements FundamentalDataService {
  constructor(private readonly deps: FundamentalDataServiceDeps) {}

  async getHighImpactNewsList(withinHours?: number): Promise<HINEvent[]> {
    if (withinHours === undefined) {
      return this.deps.newsRepository.getEvents();
    }
    return this.deps.newsRepository.getUpcoming(withinHours);
  }

  async getUpcomingEvents(range: { from: Date; to: Date }): Promise<FundamentalEvent[]> {
    return this.deps.fundamentalEventStore.getInRange(range);
  }

  async getEventDetail(eventId: string): Promise<FundamentalEvent | null> {
    return this.deps.fundamentalEventStore.getById(eventId);
  }

  async getRelevantFilings(ticker: string): Promise<SECFiling[]> {
    return this.deps.edgarClient.getRelevantFilings(ticker);
  }
}

/**
 * Ingestion entry point: takes raw events from any of the three
 * schedule/calendar sources (BLS/FRED/Fed — EDGAR is queried on-demand per
 * ticker, not ingested on a schedule) and:
 *   1. Stores every event as a `FundamentalEvent` (Chat-side broad scope).
 *   2. Runs deterministic HIN classification (hin-classification.ts) and,
 *      for matches, additionally upserts an `HINEvent` into the news
 *      repository (System-condition-eligible scope).
 * This is the shared logic the four scheduled ingestion jobs in
 * `src/ingestion/` all call after fetching from their respective client.
 */
export async function ingestFundamentalEvents(
  events: FundamentalEvent[],
  deps: { newsRepository: NewsRepository; fundamentalEventStore: FundamentalEventStore },
): Promise<{ stored: number; classifiedHin: number }> {
  await deps.fundamentalEventStore.upsert(events);

  const hinEvents: HINEvent[] = [];
  for (const event of events) {
    const classification = classifyForHin(event);
    if (!classification) continue;
    hinEvents.push({
      id: event.id,
      event: classification.displayName,
      eventTimestamp: event.eventTimestamp,
      country: event.country,
      eventType: event.eventType,
      impactLevel: classification.impactLevel,
      sourceUrl: event.sourceUrl,
      source: event.source,
      classificationListVersion: HIN_CLASSIFICATION_LIST_VERSION,
    });
  }
  if (hinEvents.length > 0) {
    await deps.newsRepository.upsertEvents(hinEvents);
  }

  return { stored: events.length, classifiedHin: hinEvents.length };
}
