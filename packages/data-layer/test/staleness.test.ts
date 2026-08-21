import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeStaleness, isMarketOpen, US_EQUITY_MARKET_HOURS } from "../src/pyth/staleness.js";

describe("computeStaleness", () => {
  test("price within threshold is fresh", () => {
    const now = new Date("2026-08-17T15:00:00Z");
    const observedAt = new Date("2026-08-17T14:59:50Z"); // 10s old
    const result = computeStaleness(observedAt, now, 15_000, null);
    assert.equal(result.isStale, false);
    assert.equal(result.isCarryForward, false);
  });

  test("price older than threshold with no market hours is stale", () => {
    const now = new Date("2026-08-17T15:00:00Z");
    const observedAt = new Date("2026-08-17T14:59:00Z"); // 60s old
    const result = computeStaleness(observedAt, now, 15_000, null);
    assert.equal(result.isStale, true);
    assert.equal(result.isCarryForward, false);
  });

  test("price older than threshold during market hours is stale (not carry-forward)", () => {
    // 2026-08-17 is a Monday. 15:00 UTC = 11:00 America/New_York (market open).
    const now = new Date("2026-08-17T15:00:00Z");
    const observedAt = new Date("2026-08-17T14:00:00Z"); // 1 hour old, market open
    const result = computeStaleness(observedAt, now, 15_000, US_EQUITY_MARKET_HOURS);
    assert.equal(result.isStale, true);
    assert.equal(result.isCarryForward, false);
  });

  test("price older than threshold outside market hours is carry-forward, not stale", () => {
    // 2026-08-17 is a Monday. 03:00 UTC = Sunday 23:00 America/New_York (market closed).
    const now = new Date("2026-08-17T03:00:00Z");
    const observedAt = new Date("2026-08-16T20:00:00Z"); // last Friday close, well past threshold
    const result = computeStaleness(observedAt, now, 15_000, US_EQUITY_MARKET_HOURS);
    assert.equal(result.isStale, false);
    assert.equal(result.isCarryForward, true);
  });

  test("weekend is treated as market closed", () => {
    // 2026-08-15 is a Saturday.
    const now = new Date("2026-08-15T15:00:00Z");
    assert.equal(isMarketOpen(now, US_EQUITY_MARKET_HOURS), false);
  });

  test("weekday during session hours is open", () => {
    // 2026-08-17 is a Monday, 15:00 UTC = 11:00 ET.
    const now = new Date("2026-08-17T15:00:00Z");
    assert.equal(isMarketOpen(now, US_EQUITY_MARKET_HOURS), true);
  });

  test("weekday before/after session hours is closed", () => {
    const beforeOpen = new Date("2026-08-17T12:00:00Z"); // 08:00 ET
    const afterClose = new Date("2026-08-17T21:30:00Z"); // 17:30 ET
    assert.equal(isMarketOpen(beforeOpen, US_EQUITY_MARKET_HOURS), false);
    assert.equal(isMarketOpen(afterClose, US_EQUITY_MARKET_HOURS), false);
  });
});
