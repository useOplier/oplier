// =============================================================================
// src/fundamental/fred-client.ts — Federal Reserve Economic Data (FRED) API.
//
// ⚠ VERIFY BEFORE DEPLOY:
//   - Requires a free FRED API key (https://fred.stlouisfed.org/docs/api/api_key.html),
//     registered per-application. Inject via `FredClientDeps.apiKey`; there
//     is no keyless fallback for FRED (unlike BLS's v1) — this client throws
//     `FredConfigError` if constructed without one, rather than silently
//     making unauthenticated requests that will 400.
//   - Series ids below (PCEPI, GDP, RSAFS, ICSA, FEDFUNDS) are FRED's
//     documented stable series ids as of training-data knowledge. FRED
//     rarely renames series ids (unlike some agencies), but confirm live
//     before deploy per this build's blanket "no unverified feed/series ids
//     in production" rule.
//   - FRED's `observations` endpoint gives data POINTS on a schedule (e.g.
//     monthly for RSAFS), not explicit "release event" timestamps distinct
//     from the observation date — same caveat as BLS: `eventTimestamp` here
//     is the FRED-reported observation/period date, which is a reasonable
//     proxy but not identical to the exact intraday release timestamp FRED's
//     source agency (BEA, Census, etc.) actually published at. Good enough
//     for day-level "upcoming this week" Chat analysis; NOT precise enough
//     for an hour-level HIN check without also confirming FRED's
//     `realtime_start` field behaves as expected — flagged, not silently
//     assumed correct.
// =============================================================================

import type { FundamentalEvent } from "../types.js";
import { BaseSourceClient, type SourceClientDeps } from "./source-client.js";

export interface FredClientDeps extends SourceClientDeps {
  apiKey: string;
}

export class FredConfigError extends Error {
  constructor() {
    super("FredClient requires a FRED API key — see fred-client.ts file header.");
    this.name = "FredConfigError";
  }
}

interface FredSeriesDefinition {
  seriesId: string;
  eventType: string;
  title: string;
}

/** ⚠ Unverified against live FRED docs — see file header. */
export const FRED_TRACKED_SERIES: FredSeriesDefinition[] = [
  { seriesId: "PCEPI", eventType: "PCE", title: "Personal Consumption Expenditures: Chain-type Price Index" },
  { seriesId: "GDP", eventType: "GDP", title: "Gross Domestic Product" },
  { seriesId: "RSAFS", eventType: "RETAIL_SALES", title: "Advance Retail Sales: Retail Trade and Food Services" },
  { seriesId: "ICSA", eventType: "INITIAL_JOBLESS_CLAIMS", title: "Initial Claims" },
  { seriesId: "FEDFUNDS", eventType: "FED_FUNDS_RATE", title: "Federal Funds Effective Rate" },
];

interface FredObservationsResponse {
  observations: Array<{
    date: string; // "YYYY-MM-DD"
    value: string; // "." for missing, per FRED convention
  }>;
}

export class FredClient extends BaseSourceClient {
  readonly sourceName = "FRED" as const;
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.stlouisfed.org/fred/series/observations";

  constructor(deps: FredClientDeps) {
    super(deps);
    if (!deps.apiKey) throw new FredConfigError();
    this.apiKey = deps.apiKey;
  }

  /** Pulls the latest observation for every tracked series (doc 01 §4's "FRED" source). */
  async fetchLatestObservations(): Promise<FundamentalEvent[]> {
    const results = await Promise.all(
      FRED_TRACKED_SERIES.map((def) => this.fetchSeries(def)),
    );
    return results.filter((e): e is FundamentalEvent => e !== null);
  }

  private async fetchSeries(def: FredSeriesDefinition): Promise<FundamentalEvent | null> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("series_id", def.seriesId);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("file_type", "json");
    url.searchParams.set("sort_order", "desc");
    url.searchParams.set("limit", "1");

    const res = await this.fetchJson<FredObservationsResponse>(url.toString());
    const latest = res.observations[0];
    // Data-integrity rule: FRED's "." sentinel for missing values must stay
    // missing, never coerced to 0 or omitted silently from `values`.
    if (!latest) return null;
    const value = latest.value === "." ? null : Number(latest.value);

    return {
      id: `fred:${def.seriesId}:${latest.date}`,
      title: def.title,
      description: `${def.title} — observation dated ${latest.date}`,
      eventTimestamp: new Date(`${latest.date}T00:00:00Z`),
      country: "US",
      eventType: def.eventType,
      impactLevel: null,
      sourceUrl: `https://fred.stlouisfed.org/series/${def.seriesId}`,
      source: "FRED",
      values: { value, rawValue: latest.value, observationDate: latest.date },
      ingestedAt: this.clock(),
    };
  }
}
