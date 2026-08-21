// =============================================================================
// src/ingestion/jobs.ts — scheduled ingestion job per source (brief,
// deliverable #4: "Working ingestion jobs for BLS, FRED, Fed, and SEC
// EDGAR"). SEC EDGAR is per-ticker/on-demand (see edgar-client.ts), not a
// scheduled calendar pull like the other three, so it has no job function
// here — `FundamentalDataService.getRelevantFilings` calls it directly.
//
// Each job function is a thin, injectable wrapper: fetch from the source
// client, run through `ingestFundamentalEvents` (shared store + HIN
// classification), return a result summary for logging/monitoring. The
// actual scheduling (cron, node-cron, a queue, EC2 systemd timer — doc 08's
// worker process is the natural home per the master plan) is an
// apps/worker-level concern, not this package's — these functions are what
// gets called on that schedule.
//
// Recommended cadence per source (documented here since the brief asks for
// "refresh cadence" in DATA_LAYER_CONTRACT.md too):
//   - BLS: daily. Most tracked series update monthly; daily polling is cheap
//     and catches revisions without needing the (unimplemented) release
//     schedule to know exactly which day to poll harder on.
//   - FRED: daily, same rationale — FRED aggregates from the same underlying
//     agencies as BLS on similar monthly/quarterly cadences.
//   - Fed: daily for the schedule sync (cheap, just re-derives from the
//     seeded/confirmed meeting list); the RSS-feed half (unimplemented) would
//     warrant hourly once built, since statements/minutes post at specific
//     known times worth catching promptly.
// =============================================================================

import { BlsClient } from "../fundamental/bls-client.js";
import { FredClient } from "../fundamental/fred-client.js";
import { FedClient } from "../fundamental/fed-client.js";
import { ingestFundamentalEvents, type FundamentalEventStore } from "../fundamental/fundamental-data-service.js";
import type { FundamentalEvent } from "../types.js";
import type { NewsRepository } from "../repository/types.js";

export interface JobDeps {
  newsRepository: NewsRepository;
  fundamentalEventStore: FundamentalEventStore;
}

export interface JobResult {
  source: string;
  ranAt: Date;
  stored: number;
  classifiedHin: number;
  error: string | null;
}

async function runJob(
  source: string,
  deps: JobDeps,
  fetchEvents: () => Promise<FundamentalEvent[]>,
): Promise<JobResult> {
  const ranAt = new Date();
  try {
    const events = await fetchEvents();
    const { stored, classifiedHin } = await ingestFundamentalEvents(events, deps);
    return { source, ranAt, stored, classifiedHin, error: null };
  } catch (err) {
    // Data-integrity rule (brief): a failed ingestion cycle stores nothing
    // and reports the failure explicitly — it never falls back to guessed
    // or stale-relabeled-as-fresh data.
    return { source, ranAt, stored: 0, classifiedHin: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runBlsIngestionJob(deps: JobDeps & { blsApiKey?: string }): Promise<JobResult> {
  const client = new BlsClient({ apiKey: deps.blsApiKey });
  return runJob("BLS", deps, () => client.fetchLatestReleases());
}

export async function runFredIngestionJob(deps: JobDeps & { fredApiKey: string }): Promise<JobResult> {
  const client = new FredClient({ apiKey: deps.fredApiKey });
  return runJob("FRED", deps, () => client.fetchLatestObservations());
}

export async function runFedIngestionJob(deps: JobDeps): Promise<JobResult> {
  const client = new FedClient();
  return runJob("FED", deps, () => client.getScheduledEvents());
}
