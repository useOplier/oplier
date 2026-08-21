// =============================================================================
// src/fundamental/bls-client.ts — Bureau of Labor Statistics Public Data API.
//
// ⚠ VERIFY BEFORE DEPLOY:
//   - BLS API v2 (https://api.bls.gov/publicAPI/v2/timeseries/data/) requires
//     a free registration key for the higher (v2) rate/query limits — v1
//     works keyless but is capped at 25 queries/day and 10 years/query,
//     which is too low for a scheduled ingestion job. Register a v2 key and
//     inject it via `BlsClientDeps.apiKey` before deploy; this file will
//     silently fall back to unauthenticated v1-shaped requests (still
//     against the v2 endpoint, `registrationkey` simply omitted) if no key
//     is provided, which is fine for local dev but NOT for scheduled
//     production ingestion.
//   - Series IDs below (CPI, Core CPI, Unemployment Rate) are BLS's
//     well-documented stable series ids as of training-data knowledge
//     (CUUR0000SA0 / CUUR0000SA0L1E / LNS14000000). Confirm they're still
//     current and haven't been superseded before relying on them — BLS does
//     occasionally revise series ids around methodology changes.
//   - NFP (Non-Farm Payrolls) is `CES0000000001` (Total Nonfarm, seasonally
//     adjusted, from the Current Employment Statistics series) — also
//     unverified live, confirm before deploy.
//   - "Release" vs "series data point" distinction: BLS's timeseries API
//     returns data points (one per period), not "this is release day X."
//     Deriving *release dates* (needed for the HIN "within N hours" check)
//     requires BLS's separate release-schedule pages/API
//     (https://www.bls.gov/schedule/news_release/2026_sched.htm or similar,
//     year-specific URL pattern) rather than the timeseries endpoint alone —
//     flagged as a genuine second BLS integration this file does NOT yet
//     implement (`getUpcomingReleaseSchedule` throws NotImplemented below).
//     Confirm the schedule endpoint's actual shape before building it for
//     real; BLS may not expose it as clean JSON.
// =============================================================================

import type { FundamentalEvent } from "../types.js";
import { BaseSourceClient, type SourceClientDeps } from "./source-client.js";

export interface BlsClientDeps extends SourceClientDeps {
  apiKey?: string;
}

interface BlsSeriesDefinition {
  seriesId: string;
  eventType: string;
  title: string;
}

/** ⚠ Unverified against live BLS docs — see file header. */
export const BLS_TRACKED_SERIES: BlsSeriesDefinition[] = [
  { seriesId: "CUUR0000SA0", eventType: "CPI", title: "CPI-U, All Items, U.S. City Average" },
  { seriesId: "CUUR0000SA0L1E", eventType: "CORE_CPI", title: "CPI-U, All Items Less Food & Energy" },
  { seriesId: "LNS14000000", eventType: "UNEMPLOYMENT_RATE", title: "Unemployment Rate" },
  { seriesId: "CES0000000001", eventType: "NFP", title: "Total Nonfarm Payroll Employment" },
  { seriesId: "WPUFD4", eventType: "PPI", title: "PPI, Final Demand" },
];

interface BlsApiResponse {
  status: string;
  Results?: {
    series: Array<{
      seriesID: string;
      data: Array<{
        year: string;
        period: string; // "M01".."M13" for monthly (M13 = annual)
        periodName: string;
        value: string;
        footnotes: Array<{ code?: string; text?: string }>;
      }>;
    }>;
  };
  message?: string[];
}

export class BlsClient extends BaseSourceClient {
  readonly sourceName = "BLS" as const;
  private readonly apiKey: string | undefined;
  private readonly baseUrl = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

  constructor(deps: BlsClientDeps = {}) {
    super(deps);
    this.apiKey = deps.apiKey;
  }

  /**
   * Pulls the most recent data points for all tracked series (doc 01 §4's
   * "BLS public data" source). Each point becomes a `FundamentalEvent` with
   * `eventTimestamp` set to the period's implied publication window — since
   * the timeseries endpoint gives the reference *period* (e.g. "2026 M07"),
   * not the exact release timestamp, `eventTimestamp` here is the last day
   * of that period as a conservative placeholder. This is NOT accurate
   * enough for the HIN "within N hours" check on its own — see the file
   * header's flag re: needing the separate release-schedule integration for
   * that. `getUpcomingEvents`/HIN classification in
   * `fundamental-data-service.ts` should be read with that caveat until the
   * schedule integration exists.
   */
  async fetchLatestReleases(): Promise<FundamentalEvent[]> {
    const seriesIds = BLS_TRACKED_SERIES.map((s) => s.seriesId);
    const body: Record<string, unknown> = {
      seriesid: seriesIds,
      startyear: String(this.clock().getUTCFullYear() - 1),
      endyear: String(this.clock().getUTCFullYear()),
    };
    if (this.apiKey) body.registrationkey = this.apiKey;

    const res = await this.fetchJson<BlsApiResponse>(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status !== "REQUEST_SUCCEEDED") {
      // Data-integrity rule: never fabricate. A failed/degraded response
      // yields zero events, not guessed ones.
      return [];
    }

    const events: FundamentalEvent[] = [];
    for (const series of res.Results?.series ?? []) {
      const def = BLS_TRACKED_SERIES.find((s) => s.seriesId === series.seriesID);
      if (!def) continue;
      const latest = series.data[0]; // BLS returns most-recent-first
      if (!latest) continue;

      events.push({
        id: `bls:${series.seriesID}:${latest.year}:${latest.period}`,
        title: def.title,
        description: `${def.title} — ${latest.periodName} ${latest.year}`,
        // Placeholder period-end timestamp — see method doc comment.
        eventTimestamp: new Date(Date.UTC(Number(latest.year), monthFromPeriod(latest.period), 1)),
        country: "US",
        eventType: def.eventType,
        impactLevel: null, // HIN classification is applied by fundamental-data-service.ts, not here.
        sourceUrl: `https://beta.bls.gov/dataViewer/view/timeseries/${series.seriesID}`,
        source: "BLS",
        values: { value: latest.value, period: latest.period, year: latest.year },
        ingestedAt: this.clock(),
      });
    }
    return events;
  }

  /**
   * NOT IMPLEMENTED — see file header. BLS's release-SCHEDULE (as opposed
   * to release DATA) needs a separate, unverified integration. Throws
   * explicitly rather than returning a guessed/fabricated schedule.
   */
  async getUpcomingReleaseSchedule(): Promise<never> {
    throw new Error(
      "BlsClient.getUpcomingReleaseSchedule is not implemented — BLS's release-schedule " +
        "endpoint shape needs live verification before this can be built without guessing. " +
        "See bls-client.ts file header.",
    );
  }
}

function monthFromPeriod(period: string): number {
  // "M01".."M12" → 0-indexed month; "M13" (annual average) has no real month, clamp to December.
  const n = Number(period.replace("M", ""));
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(n, 12) - 1;
}
