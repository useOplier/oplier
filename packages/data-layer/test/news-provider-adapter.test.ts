import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { HinNewsDataProviderAdapter } from "../src/fundamental/news-provider-adapter.js";
import { InMemoryNewsRepository } from "../src/repository/in-memory-repository.js";

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 3600_000);
}

describe("HinNewsDataProviderAdapter — engine-exact NewsDataProvider", () => {
  test("returns true when a HIGH impact event falls within the window", async () => {
    const newsRepository = new InMemoryNewsRepository();
    await newsRepository.upsertEvents([
      {
        id: "1",
        event: "CPI",
        eventTimestamp: hoursFromNow(0.5),
        country: "US",
        eventType: "CPI",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
    ]);
    const adapter = new HinNewsDataProviderAdapter(newsRepository);
    assert.equal(await adapter.hasUpcomingHighImpactEvent(1), true);
  });

  test("returns false when the only upcoming event is MEDIUM/LOW impact", async () => {
    const newsRepository = new InMemoryNewsRepository();
    await newsRepository.upsertEvents([
      {
        id: "1",
        event: "PPI",
        eventTimestamp: hoursFromNow(0.5),
        country: "US",
        eventType: "PPI",
        impactLevel: "MEDIUM",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
    ]);
    const adapter = new HinNewsDataProviderAdapter(newsRepository);
    assert.equal(await adapter.hasUpcomingHighImpactEvent(1), false);
  });

  test("returns false when the HIGH impact event falls outside the window", async () => {
    const newsRepository = new InMemoryNewsRepository();
    await newsRepository.upsertEvents([
      {
        id: "1",
        event: "NFP",
        eventTimestamp: hoursFromNow(30), // outside the 24h window
        country: "US",
        eventType: "NFP",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "BLS",
        classificationListVersion: "v1",
      },
    ]);
    const adapter = new HinNewsDataProviderAdapter(newsRepository);
    assert.equal(await adapter.hasUpcomingHighImpactEvent(24), false);
  });

  test("respects the 1-hour vs 24-hour window distinction", async () => {
    const newsRepository = new InMemoryNewsRepository();
    await newsRepository.upsertEvents([
      {
        id: "1",
        event: "FOMC Rate Decision",
        eventTimestamp: hoursFromNow(5),
        country: "US",
        eventType: "FOMC_RATE_DECISION",
        impactLevel: "HIGH",
        sourceUrl: null,
        source: "FED",
        classificationListVersion: "v1",
      },
    ]);
    const adapter = new HinNewsDataProviderAdapter(newsRepository);
    assert.equal(await adapter.hasUpcomingHighImpactEvent(1), false);
    assert.equal(await adapter.hasUpcomingHighImpactEvent(24), true);
  });
});
