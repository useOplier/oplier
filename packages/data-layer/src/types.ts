// =============================================================================
// src/types.ts — Part D+J shared types
//
// Two interface families live here:
//   1. PriceDataProvider / NewsDataProvider — the EXACT shapes Part C's engine
//      (ENGINE_CONTRACT.md §1) imports from `src/types.ts` in `@oplier/engine`.
//      These are reproduced here verbatim, not paraphrased, so `PythAdapter`
//      and `HinNewsDataProviderAdapter` are structurally assignable to what
//      the engine actually consumes.
//   2. FundamentalDataService + the richer "detailed" price/history surface —
//      the shapes the Part D+J brief itself specifies, for callers that are
//      NOT the engine (apps/api routes, chart data, LLM #1 tools via Part G).
//
// See DATA_LAYER_CONTRACT.md §1 for the full reconciliation of where these
// two families diverge and why both exist.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. Engine-consumed interfaces (must match ENGINE_CONTRACT.md exactly)
// -----------------------------------------------------------------------------

/**
 * Reproduced verbatim from ENGINE_CONTRACT.md §1 ("PriceDataProvider — Part D
 * implements for real, against Pyth"). Part C's engine imports a type shaped
 * exactly like this from its own `src/types.ts` — this is Part D's mirror of
 * it, and `PythAdapter.getCurrentPrice` below is typed to satisfy it exactly.
 *
 * NOTE the divergence from the brief's own interface sketch (which adds a
 * `source: 'pyth'` field, a `{ unavailable: true; reason }` union member, a
 * `Date` timestamp instead of `number`, and a `getHistoricalPrices` method).
 * That divergence is real and is flagged, not silently resolved — see
 * DATA_LAYER_CONTRACT.md §1. This type is intentionally the narrower,
 * engine-exact one; the fuller shape lives below as `DetailedPriceResult`.
 */
export interface PriceDataProvider {
  getCurrentPrice(assetId: string): Promise<{
    price: number;
    timestamp: number;
    isStale: boolean;
  }>;
}

/**
 * Reproduced verbatim from ENGINE_CONTRACT.md §1 ("NewsDataProvider — flagged
 * addition, not one of the brief's three named interfaces"). The engine polls
 * this on its 60s HIGH_IMPACT_NEWS cadence (ENGINE_CONTRACT.md §5).
 */
export interface NewsDataProvider {
  hasUpcomingHighImpactEvent(withinHours: 1 | 24): Promise<boolean>;
}

// -----------------------------------------------------------------------------
// 2. Part D — the brief's fuller price-data surface (non-engine callers)
// -----------------------------------------------------------------------------

export type DetailedPriceResult =
  | {
      price: number;
      timestamp: Date;
      isStale: boolean;
      source: "pyth";
      /**
       * Distinguishes "Pyth pushed a new observation this cycle" from
       * "market is closed / feed hasn't updated, this is the last known
       * price carried forward" — doc 05 §6 last line, for assets with
       * defined market hours (AAPLx, GLDx, METAx, NVDAx — not USDG).
       */
      isCarryForward: boolean;
    }
  | { unavailable: true; reason: string };

export interface PricePoint {
  assetId: string;
  price: number;
  observedAt: Date;
  source: "pyth";
}

/**
 * The brief's full `PriceDataProvider` sketch (doc D §"Interface contract").
 * `PythAdapter` implements this in addition to the narrower engine-exact
 * `PriceDataProvider` above — see DATA_LAYER_CONTRACT.md §1 for why both
 * exist on the same class rather than picking one.
 */
export interface PriceDataProviderDetailed {
  /**
   * Named `getCurrentPriceDetailed`, not `getCurrentPrice` as the brief's
   * literal sketch had it — `PythAdapter` implements both this interface
   * and the engine-exact `PriceDataProvider` above on one class, and the
   * two `getCurrentPrice*` methods have incompatible return types
   * (union-with-unavailable vs. always-a-value). TypeScript can't have one
   * class implement two interfaces with the same method name and
   * incompatible signatures, so this method is deliberately renamed rather
   * than silently picking one shape and dropping the other. Flagged here,
   * not just in the adapter, since this is the interface definition itself
   * diverging from the brief's literal text — see DATA_LAYER_CONTRACT.md §1.
   */
  getCurrentPriceDetailed(assetId: string): Promise<DetailedPriceResult>;
  getHistoricalPrices(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]>;
}

// -----------------------------------------------------------------------------
// 3. Part J — fundamental / news data
// -----------------------------------------------------------------------------

/** One of the product's own curated, versioned HIN classifications (doc 01 §10). */
export type HinImpactLevel = "HIGH" | "MEDIUM" | "LOW";

/**
 * Matches `high_impact_news_events` (full_schema.txt `news.ts`) field-for-field,
 * plus the structured shape doc 01 §10 specifies the backend hands the engine:
 * `{ event, timestamp, country, event_type, impact_level }`.
 */
export interface HINEvent {
  id: string;
  event: string;
  eventTimestamp: Date;
  country: string;
  eventType: string;
  impactLevel: HinImpactLevel;
  sourceUrl: string | null;
  /** Which approved source produced this row, for attribution/debugging. */
  source: "BLS" | "FRED" | "FED" | "SEC_EDGAR";
  /** Which version of HIN_CLASSIFICATION_LIST classified this row. */
  classificationListVersion: string;
}

/**
 * A broader fundamental/economic event than HIN — used by Chat-side
 * fundamental analysis (doc 01 §2, doc 02 "Fundamental Analysis"), which is
 * explicitly broader in scope than the HIN-only condition Systems can use
 * (doc 02 "the only news-based condition is predefined High Impact News").
 */
export interface FundamentalEvent {
  id: string;
  title: string;
  description: string | null;
  eventTimestamp: Date;
  country: string;
  eventType: string;
  /** Present only if this event also cleared HIN classification. */
  impactLevel: HinImpactLevel | null;
  sourceUrl: string | null;
  source: "BLS" | "FRED" | "FED" | "SEC_EDGAR";
  /** Raw/actual/forecast/previous values where the source provides them (e.g. FRED series points, BLS releases). Never fabricated — absent fields stay absent. */
  values: Record<string, string | number | null> | null;
  ingestedAt: Date;
}

export interface SECFiling {
  ticker: string;
  cik: string;
  accessionNumber: string;
  formType: string;
  filedAt: Date;
  reportDate: Date | null;
  primaryDocumentUrl: string;
  companyName: string;
}

/**
 * Interface contract from the brief, produced for Part B (HIN endpoint) and
 * Part G (LLM #1 tools). Pure data retrieval and classification — no LLM
 * calls, no interpretation (brief "Out of scope").
 */
export interface FundamentalDataService {
  getHighImpactNewsList(withinHours?: number): Promise<HINEvent[]>;
  getUpcomingEvents(range: { from: Date; to: Date }): Promise<FundamentalEvent[]>;
  getEventDetail(eventId: string): Promise<FundamentalEvent | null>;
  getRelevantFilings(ticker: string): Promise<SECFiling[]>;
}

// -----------------------------------------------------------------------------
// 4. Errors
// -----------------------------------------------------------------------------

/**
 * Thrown by `PythAdapter.getCurrentPrice` (the engine-exact method) when no
 * valid price exists at all — not even a stale cached one — for the
 * requested asset. See DATA_LAYER_CONTRACT.md §1: the engine-exact
 * `PriceDataProvider` type has no "unavailable" union member, so there is no
 * way to express this as a normal return value on that method without
 * fabricating a price. `getCurrentPriceDetailed` returns the
 * `{ unavailable: true, reason }` shape instead of throwing, for callers
 * that can handle it as data.
 */
export class PriceUnavailableError extends Error {
  constructor(
    public readonly assetId: string,
    reason: string,
  ) {
    super(`Price unavailable for ${assetId}: ${reason}`);
    this.name = "PriceUnavailableError";
  }
}
