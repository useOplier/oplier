import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FundamentalDataServiceImpl,
  InMemoryFundamentalEventStore,
  ingestFundamentalEvents,
} from "../src/fundamental/fundamental-data-service.js";
import { InMemoryNewsRepository } from "../src/repository/in-memory-repository.js";
import type { FundamentalEvent, SECFiling } from "../src/types.js";
import type { EdgarClient } from "../src/fundamental/edgar-client.js";

function makeEvent(overrides: Partial<FundamentalEvent> = {}): FundamentalEvent {
  return {
    id: "test:1",
    title: "Test Event",
    description: null,
    eventTimestamp: new Date("2026-08-20T12:30:00Z"),
    country: "US",
    eventType: "CPI",
    impactLevel: null,
    sourceUrl: null,
    source: "BLS",
    values: null,
    ingestedAt: new Date("2026-08-17T00:00:00Z"),
    ...overrides,
  };
}

describe("ingestFundamentalEvents — the shared ingestion pipeline", () => {
  test("stores every event in the broad FundamentalEvent store regardless of classification", async () => {
    const newsRepository = new InMemoryNewsRepository();
    const fundamentalEventStore = new InMemoryFundamentalEventStore();
    const events = [makeEvent({ id: "a", eventType: "CPI" }), makeEvent({ id: "b", eventType: "SOME_UNCLASSIFIED_THING" })];

    const result = await ingestFundamentalEvents(events, { newsRepository, fundamentalEventStore });

    assert.equal(result.stored, 2);
    assert.equal((await fundamentalEventStore.getById("a")) !== null, true);
    assert.equal((await fundamentalEventStore.getById("b")) !== null, true);
  });

  test("only HIN-classifiable events land in the news repository", async () => {
    const newsRepository = new InMemoryNewsRepository();
    const fundamentalEventStore = new InMemoryFundamentalEventStore();
    const events = [
      makeEvent({ id: "cpi-event", eventType: "CPI" }),
      makeEvent({ id: "unclassified-event", eventType: "SOME_UNCLASSIFIED_THING" }),
    ];

    const result = await ingestFundamentalEvents(events, { newsRepository, fundamentalEventStore });

    assert.equal(result.classifiedHin, 1);
    const hinEvents = await newsRepository.getEvents();
    assert.equal(hinEvents.length, 1);
    assert.equal(hinEvents[0]?.eventType, "CPI");
    assert.equal(hinEvents[0]?.impactLevel, "HIGH");
  });

  test("the LLM never touches classification — it is purely a function of eventType+country", async () => {
    const newsRepository = new InMemoryNewsRepository();
    const fundamentalEventStore = new InMemoryFundamentalEventStore();
    const events = [makeEvent({ id: "x", eventType: "FOMC_RATE_DECISION", title: "Whatever text arrived" })];

    await ingestFundamentalEvents(events, { newsRepository, fundamentalEventStore });

    const hinEvents = await newsRepository.getEvents();
    // displayName comes from the curated list, not from the ingested event's own title —
    // proof that classification/display text is backend-owned, not pass-through.
    assert.equal(hinEvents[0]?.event, "FOMC Interest Rate Decision");
  });
});

describe("FundamentalDataService", () => {
  function makeService() {
    const newsRepository = new InMemoryNewsRepository();
    const fundamentalEventStore = new InMemoryFundamentalEventStore();
    const fakeFilings: SECFiling[] = [
      {
        ticker: "AAPL",
        cik: "0000320193",
        accessionNumber: "0000320193-26-000010",
        formType: "10-Q",
        filedAt: new Date("2026-08-01T00:00:00Z"),
        reportDate: new Date("2026-06-30T00:00:00Z"),
        primaryDocumentUrl: "https://example.com/filing.htm",
        companyName: "Apple Inc.",
      },
    ];
    const edgarClient = {
      getRelevantFilings: async (ticker: string) => (ticker === "AAPL" ? fakeFilings : []),
    } as unknown as EdgarClient;

    const service = new FundamentalDataServiceImpl({ newsRepository, edgarClient, fundamentalEventStore });
    return { service, newsRepository, fundamentalEventStore };
  }

  test("getHighImpactNewsList with no argument returns all HIN events", async () => {
    const { service, newsRepository } = makeService();
    await newsRepository.upsertEvents([
      {
        id: "1",
        event: "CPI",
        eventTimestamp: new Date(Date.now() + 3600_000),
        country: "US",
        eventType: "CPI",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
    ]);
    const list = await service.getHighImpactNewsList();
    assert.equal(list.length, 1);
  });

  test("getHighImpactNewsList(withinHours) filters to the window", async () => {
    const { service, newsRepository } = makeService();
    await newsRepository.upsertEvents([
      {
        id: "soon",
        event: "CPI",
        eventTimestamp: new Date(Date.now() + 30 * 60_000), // 30 min from now
        country: "US",
        eventType: "CPI",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
      {
        id: "later",
        event: "NFP",
        eventTimestamp: new Date(Date.now() + 48 * 3600_000), // 2 days from now
        country: "US",
        eventType: "NFP",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
    ]);
    const withinOneHour = await service.getHighImpactNewsList(1);
    assert.equal(withinOneHour.length, 1);
    assert.equal(withinOneHour[0]?.id, "soon");
  });

  test("getUpcomingEvents returns broad (non-HIN-filtered) events in range", async () => {
    const { service, fundamentalEventStore } = makeService();
    await fundamentalEventStore.upsert([
      makeEvent({ id: "in-range", eventTimestamp: new Date("2026-08-20T00:00:00Z") }),
      makeEvent({ id: "out-of-range", eventTimestamp: new Date("2026-09-20T00:00:00Z") }),
    ]);
    const events = await service.getUpcomingEvents({
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-08-31T00:00:00Z"),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.id, "in-range");
  });

  test("getEventDetail returns null for an unknown id — never fabricates a filler event", async () => {
    const { service } = makeService();
    const result = await service.getEventDetail("does-not-exist");
    assert.equal(result, null);
  });

  test("getRelevantFilings delegates to the EDGAR client and returns [] for unresolved tickers", async () => {
    const { service } = makeService();
    const aapl = await service.getRelevantFilings("AAPL");
    assert.equal(aapl.length, 1);
    const unknown = await service.getRelevantFilings("NOTATICKER");
    assert.equal(unknown.length, 0);
  });
});
