// =============================================================================
// src/fundamental/fed-client.ts — Federal Reserve sources: FOMC meeting
// calendar + statements (doc 01 §4's "Federal Reserve sources").
//
// ⚠ VERIFY BEFORE DEPLOY — this is the least-certain of the four source
// integrations:
//   - Unlike BLS/FRED/EDGAR, the Federal Reserve does not publish a
//     documented, stable JSON API for the FOMC meeting calendar as of this
//     model's training-data knowledge. The calendar is published as an HTML
//     page (federalreserve.gov/monetarypolicy/fomccalendars.htm). Two real
//     options exist and NEITHER is confirmed live in this build chat:
//       1. Structured scraping of that HTML page (fragile — page structure
//          changes break ingestion silently unless monitored).
//       2. The Federal Reserve's press-release RSS feed
//          (federalreserve.gov/feeds/press_all.xml or the monetary-policy-
//          specific feed) for statements/minutes, combined with a
//          hand-maintained annual meeting-date list (the Fed publishes the
//          upcoming year's FOMC meeting dates well in advance as a fixed
//          schedule — this could be seeded manually once a year rather than
//          scraped, which is more robust for the *dates* half of this even
//          if less "fully automated").
//     This file implements a `FedClient` shaped around option 2's
//     RSS-for-statements + a manually-seeded `FOMC_MEETING_SCHEDULE`
//     constant for dates, since a hand-seeded schedule cannot silently break
//     from a page-structure change and the Fed does publish these dates far
//     in advance. Confirm this design choice with the manager thread — the
//     brief's own "no scraping where an official API exists" preference
//     doesn't fully resolve which of these two is "more official" when
//     neither is a real API.
//   - `FOMC_MEETING_SCHEDULE` below is transcribed from training-data
//     knowledge of the Fed's typical ~8-meetings-per-year cadence and is
//     NOT confirmed against the Fed's actual published 2026 calendar.
//     Replace with the real dates from federalreserve.gov before this ships.
// =============================================================================

import type { FundamentalEvent } from "../types.js";
import { BaseSourceClient, type SourceClientDeps } from "./source-client.js";

/**
 * ⚠ UNVERIFIED placeholder dates — see file header. Each entry is a
 * two-day meeting; the rate decision + statement publish on the second day,
 * historically 2:00pm ET (14:00 America/New_York) as of training-data
 * knowledge — also unverified live, the exact time has been known to shift.
 */
export const FOMC_MEETING_SCHEDULE_2026: Array<{ decisionDateUtc: string; hasPressConference: boolean }> = [
  { decisionDateUtc: "2026-01-28T19:00:00Z", hasPressConference: true },
  { decisionDateUtc: "2026-03-18T18:00:00Z", hasPressConference: true },
  { decisionDateUtc: "2026-04-29T18:00:00Z", hasPressConference: false },
  { decisionDateUtc: "2026-06-17T18:00:00Z", hasPressConference: true },
  { decisionDateUtc: "2026-07-29T18:00:00Z", hasPressConference: false },
  { decisionDateUtc: "2026-09-16T18:00:00Z", hasPressConference: true },
  { decisionDateUtc: "2026-10-28T18:00:00Z", hasPressConference: false },
  { decisionDateUtc: "2026-12-09T19:00:00Z", hasPressConference: true },
];

export interface FedClientDeps extends SourceClientDeps {
  /** Overridable so a real, confirmed schedule (or a future scraper's output) can replace the placeholder above. */
  meetingSchedule?: Array<{ decisionDateUtc: string; hasPressConference: boolean }>;
}

export class FedClient extends BaseSourceClient {
  readonly sourceName = "FED" as const;
  private readonly meetingSchedule: Array<{ decisionDateUtc: string; hasPressConference: boolean }>;

  constructor(deps: FedClientDeps = {}) {
    super(deps);
    this.meetingSchedule = deps.meetingSchedule ?? FOMC_MEETING_SCHEDULE_2026;
  }

  /**
   * Produces the FOMC_RATE_DECISION / FOMC_STATEMENT / FOMC_PRESS_CONFERENCE
   * events from the seeded schedule. Minutes (`FOMC_MINUTES`, released ~3
   * weeks after each meeting) are NOT generated here yet — that needs the
   * RSS-feed half of this client (statements/minutes text), which is a
   * separate, unimplemented method below pending live verification of the
   * feed URL/shape.
   */
  async getScheduledEvents(): Promise<FundamentalEvent[]> {
    const events: FundamentalEvent[] = [];
    for (const meeting of this.meetingSchedule) {
      const decisionDate = new Date(meeting.decisionDateUtc);
      events.push({
        id: `fed:fomc-decision:${meeting.decisionDateUtc}`,
        title: "FOMC Interest Rate Decision",
        description: "Federal Open Market Committee interest rate decision.",
        eventTimestamp: decisionDate,
        country: "US",
        eventType: "FOMC_RATE_DECISION",
        impactLevel: null,
        sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        source: "FED",
        values: null,
        ingestedAt: this.clock(),
      });
      events.push({
        id: `fed:fomc-statement:${meeting.decisionDateUtc}`,
        title: "FOMC Statement",
        description: "Federal Open Market Committee post-meeting statement.",
        eventTimestamp: decisionDate,
        country: "US",
        eventType: "FOMC_STATEMENT",
        impactLevel: null,
        sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        source: "FED",
        values: null,
        ingestedAt: this.clock(),
      });
      if (meeting.hasPressConference) {
        events.push({
          id: `fed:fomc-presser:${meeting.decisionDateUtc}`,
          title: "FOMC Press Conference",
          description: "Chair press conference following the FOMC statement.",
          // ⚠ Unverified offset — training-data knowledge puts this ~30min after the decision; confirm live.
          eventTimestamp: new Date(decisionDate.getTime() + 30 * 60 * 1000),
          country: "US",
          eventType: "FOMC_PRESS_CONFERENCE",
          impactLevel: null,
          sourceUrl: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
          source: "FED",
          values: null,
          ingestedAt: this.clock(),
        });
      }
    }
    return events;
  }

  /**
   * NOT IMPLEMENTED. FOMC minutes + the RSS-feed-backed statement text
   * ingestion need a live-verified feed URL before this can be built
   * without guessing. Throws explicitly rather than fabricating content.
   */
  async fetchMinutesAndStatementText(): Promise<never> {
    throw new Error(
      "FedClient.fetchMinutesAndStatementText is not implemented — the Fed RSS feed " +
        "URL/shape needs live verification. See fed-client.ts file header.",
    );
  }
}
