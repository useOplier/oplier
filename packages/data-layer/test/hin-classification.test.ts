import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyEventType, classifyForHin, HIN_CLASSIFICATION_LIST } from "../src/fundamental/hin-classification.js";

describe("classifyEventType", () => {
  test("matches a known event type exactly", () => {
    const rule = classifyEventType("CPI");
    assert.ok(rule);
    assert.equal(rule?.impactLevel, "HIGH");
  });

  test("normalizes whitespace/hyphens/case before matching", () => {
    const rule = classifyEventType("  fomc rate-decision ");
    assert.ok(rule);
    assert.equal(rule?.eventType, "FOMC_RATE_DECISION");
  });

  test("returns null for an event type not on the curated list", () => {
    assert.equal(classifyEventType("RANDOM_UNCLASSIFIED_THING"), null);
  });

  test("every curated rule has a unique eventType", () => {
    const types = HIN_CLASSIFICATION_LIST.map((r) => r.eventType);
    assert.equal(new Set(types).size, types.length);
  });
});

describe("classifyForHin — the deterministic entry point Systems/engine rely on", () => {
  test("classifies a matching US CPI event as HIGH impact", () => {
    const result = classifyForHin({ eventType: "CPI", country: "US" });
    assert.deepEqual(result, { impactLevel: "HIGH", displayName: "Consumer Price Index (CPI)" });
  });

  test("returns null for an unclassified event type — never guesses an impact level", () => {
    const result = classifyForHin({ eventType: "SOME_UNKNOWN_RELEASE", country: "US" });
    assert.equal(result, null);
  });

  test("country mismatch against the curated rule returns null, not a wrong-country classification", () => {
    // CPI is curated as a US event; a hypothetical non-US CPI release must not
    // silently inherit the US classification.
    const result = classifyForHin({ eventType: "CPI", country: "DE" });
    assert.equal(result, null);
  });

  test("FOMC minutes classify as MEDIUM, not HIGH — distinct tier from the live decision", () => {
    const result = classifyForHin({ eventType: "FOMC_MINUTES", country: "US" });
    assert.equal(result?.impactLevel, "MEDIUM");
  });

  test("initial jobless claims classify as LOW", () => {
    const result = classifyForHin({ eventType: "INITIAL_JOBLESS_CLAIMS", country: "US" });
    assert.equal(result?.impactLevel, "LOW");
  });
});
