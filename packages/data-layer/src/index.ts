// =============================================================================
// src/index.ts — package barrel export.
// =============================================================================

// Types / contracts
export type {
  PriceDataProvider,
  NewsDataProvider,
  DetailedPriceResult,
  PricePoint,
  PriceDataProviderDetailed,
  HinImpactLevel,
  HINEvent,
  FundamentalEvent,
  SECFiling,
  FundamentalDataService,
} from "./types.js";
export { PriceUnavailableError } from "./types.js";

// Part D — Pyth prices
export { PythAdapter } from "./pyth/pyth-adapter.js";
export type { PythAdapterDeps } from "./pyth/pyth-adapter.js";
export { HermesStreamClient, MockPythStreamClient } from "./pyth/stream-client.js";
export type { PythStreamClient, PythPriceUpdate } from "./pyth/stream-client.js";
export { PYTH_FEED_REGISTRY, resolveFeedIdFromLocalRegistry } from "./pyth/feed-registry.js";
export {
  computeStaleness,
  isMarketOpen,
  DEFAULT_FRESHNESS_THRESHOLD_MS,
  US_EQUITY_MARKET_HOURS,
} from "./pyth/staleness.js";
export type { MarketHours, StalenessResult } from "./pyth/staleness.js";

// Part J — fundamental data + HIN
export {
  HIN_CLASSIFICATION_LIST,
  HIN_CLASSIFICATION_LIST_VERSION,
  classifyEventType,
  classifyForHin,
} from "./fundamental/hin-classification.js";
export { BlsClient, BLS_TRACKED_SERIES } from "./fundamental/bls-client.js";
export { FredClient, FredConfigError, FRED_TRACKED_SERIES } from "./fundamental/fred-client.js";
export { FedClient, FOMC_MEETING_SCHEDULE_2026 } from "./fundamental/fed-client.js";
export { EdgarClient, EdgarConfigError, RELEVANT_FORM_TYPES } from "./fundamental/edgar-client.js";
export {
  FundamentalDataServiceImpl,
  InMemoryFundamentalEventStore,
  ingestFundamentalEvents,
} from "./fundamental/fundamental-data-service.js";
export type { FundamentalDataServiceDeps, FundamentalEventStore } from "./fundamental/fundamental-data-service.js";
export { HinNewsDataProviderAdapter } from "./fundamental/news-provider-adapter.js";

// Ingestion jobs
export { runBlsIngestionJob, runFredIngestionJob, runFedIngestionJob } from "./ingestion/jobs.js";
export type { JobDeps, JobResult } from "./ingestion/jobs.js";

// Repository seam
export { InMemoryPriceRepository, InMemoryNewsRepository } from "./repository/in-memory-repository.js";
export type { PriceRepository, NewsRepository, LatestPriceRow } from "./repository/types.js";
