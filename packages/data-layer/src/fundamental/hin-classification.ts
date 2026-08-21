// =============================================================================
// src/fundamental/hin-classification.ts — doc 01 §10 / doc 02 (locked,
// critical): the product's OWN predefined, curated, versioned HIN list.
// Forex Factory is a guide only, per the brief — no FF API/integration
// anywhere in this file or package. The LLM never decides impact
// classification; this is deterministic, backend-owned matching against a
// fixed table.
// =============================================================================

import type { FundamentalEvent, HinImpactLevel } from "../types.js";

export const HIN_CLASSIFICATION_LIST_VERSION = "2026-08-17.v1";

export interface HinClassificationRule {
  /** Matched against the ingested event's normalized `eventType` (case-insensitive substring/exact, see matchesRule). */
  eventType: string;
  /** Human-readable canonical name shown to the user (doc 02: "must show the currently classified High Impact events"). */
  displayName: string;
  country: string;
  impactLevel: HinImpactLevel;
  /** Which of the 4 approved sources normally publishes this event type. */
  primarySource: "BLS" | "FRED" | "FED" | "SEC_EDGAR";
  /** Forex-Factory-style informal cross-reference, guide only — not a data dependency. */
  forexFactoryGuideNote: string;
}

/**
 * Curated HIN list, v1. Scoped to US macro/regulatory events the four
 * approved sources actually structurally publish (brief: "cross-referenced
 * against Forex Factory's common classifications as a guide only"). This is
 * a starting curated set, not exhaustive — extending it is a versioned,
 * reviewed change (bump `HIN_CLASSIFICATION_LIST_VERSION`), never an
 * LLM-time decision.
 *
 * ⚠ Product/compliance review flag: this is Part D+J's own first-pass
 * curation against the doc's examples ("CPI release, FOMC rate decision, NFP
 * jobs report, etc."). The "etc." is this build chat's judgment call on
 * which additional BLS/FRED/Fed releases commonly rank HIGH on
 * Forex-Factory-style calendars — confirm this list (especially MEDIUM vs
 * HIGH boundaries) with the manager thread before it ships as the list users
 * see before creating a news-based System.
 */
export const HIN_CLASSIFICATION_LIST: HinClassificationRule[] = [
  {
    eventType: "CPI",
    displayName: "Consumer Price Index (CPI)",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "BLS",
    forexFactoryGuideNote: "Consistently ranked highest-impact USD release.",
  },
  {
    eventType: "CORE_CPI",
    displayName: "Core CPI (ex. food & energy)",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "BLS",
    forexFactoryGuideNote: "Released alongside headline CPI, same high-impact tier.",
  },
  {
    eventType: "FOMC_RATE_DECISION",
    displayName: "FOMC Interest Rate Decision",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "FED",
    forexFactoryGuideNote: "Highest-impact scheduled USD event alongside CPI/NFP.",
  },
  {
    eventType: "FOMC_STATEMENT",
    displayName: "FOMC Statement",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "FED",
    forexFactoryGuideNote: "Published simultaneously with the rate decision.",
  },
  {
    eventType: "FOMC_PRESS_CONFERENCE",
    displayName: "FOMC Press Conference",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "FED",
    forexFactoryGuideNote: "Chair press conference following the statement — frequently market-moving independent of the decision itself.",
  },
  {
    eventType: "FOMC_MINUTES",
    displayName: "FOMC Meeting Minutes",
    country: "US",
    impactLevel: "MEDIUM",
    primarySource: "FED",
    forexFactoryGuideNote: "Released ~3 weeks after each meeting; lower impact than the live decision.",
  },
  {
    eventType: "NFP",
    displayName: "Non-Farm Payrolls (Employment Situation)",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "BLS",
    forexFactoryGuideNote: "Classic top-tier monthly USD release.",
  },
  {
    eventType: "UNEMPLOYMENT_RATE",
    displayName: "Unemployment Rate",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "BLS",
    forexFactoryGuideNote: "Released alongside NFP in the same Employment Situation report.",
  },
  {
    eventType: "PPI",
    displayName: "Producer Price Index (PPI)",
    country: "US",
    impactLevel: "MEDIUM",
    primarySource: "BLS",
    forexFactoryGuideNote: "Usually ranked below CPI but above most other inflation-adjacent prints.",
  },
  {
    eventType: "PCE",
    displayName: "PCE Price Index",
    country: "US",
    impactLevel: "HIGH",
    primarySource: "FRED",
    forexFactoryGuideNote: "The Fed's preferred inflation gauge — high impact despite lower retail-trader awareness than CPI.",
  },
  {
    eventType: "GDP",
    displayName: "Gross Domestic Product (Advance/Preliminary/Final)",
    country: "US",
    impactLevel: "MEDIUM",
    primarySource: "FRED",
    forexFactoryGuideNote: "Quarterly, three releases per quarter (advance/second/third) — advance estimate typically ranked highest of the three.",
  },
  {
    eventType: "RETAIL_SALES",
    displayName: "Retail Sales",
    country: "US",
    impactLevel: "MEDIUM",
    primarySource: "FRED",
    forexFactoryGuideNote: "Monthly consumer-spending proxy, consistently mid-to-high impact.",
  },
  {
    eventType: "INITIAL_JOBLESS_CLAIMS",
    displayName: "Initial Jobless Claims",
    country: "US",
    impactLevel: "LOW",
    primarySource: "FRED",
    forexFactoryGuideNote: "Weekly — usually low impact individually, occasionally elevated during labor-market stress periods.",
  },
  {
    eventType: "FED_FUNDS_RATE",
    displayName: "Federal Funds Rate (target range, as published data series)",
    country: "US",
    impactLevel: "MEDIUM",
    primarySource: "FRED",
    forexFactoryGuideNote: "The FRED series itself is a data update, not the live decision — HIGH impact is reserved for the actual FOMC_RATE_DECISION event.",
  },
];

/** Normalizes free-text event descriptions from ingestion sources into the fixed `eventType` vocabulary above. */
export function classifyEventType(rawEventType: string): HinClassificationRule | null {
  const normalized = rawEventType.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return HIN_CLASSIFICATION_LIST.find((rule) => rule.eventType === normalized) ?? null;
}

/**
 * Deterministic classification entry point (brief: "The LLM never decides
 * impact classification — deterministic, backend-owned only"). Returns null
 * for anything not on the curated list — those events are still valid
 * `FundamentalEvent`s for Chat-side analysis (doc 02, broader scope) but are
 * NOT High Impact News and cannot back a HIGH_IMPACT_NEWS System condition.
 */
export function classifyForHin(event: Pick<FundamentalEvent, "eventType" | "country">): {
  impactLevel: HinImpactLevel;
  displayName: string;
} | null {
  const rule = classifyEventType(event.eventType);
  if (!rule) return null;
  if (rule.country !== event.country) return null;
  return { impactLevel: rule.impactLevel, displayName: rule.displayName };
}
