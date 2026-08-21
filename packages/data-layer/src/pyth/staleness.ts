// =============================================================================
// src/pyth/staleness.ts — doc 05 §6 (locked): staleness + carry-forward logic,
// kept as pure functions so it's trivially unit-testable without any Pyth
// client at all.
// =============================================================================

/**
 * Freshness threshold. Chosen value + rationale (brief requires both):
 *
 * 15 seconds. The engine's price-driven monitoring cadence is 7s
 * (ENGINE_CONTRACT.md §5, "5-10s range", implemented at 7000ms) — the
 * threshold needs to comfortably exceed one monitoring tick so a single
 * slow/delayed Hermes response doesn't flip a genuinely-fresh price to
 * stale and suppress a real trigger, while still being tight enough that a
 * truly stuck feed gets marked stale well within a couple of monitoring
 * cycles (financial product — doc 05 §6 calls this "critical"). 15s is
 * ~2x the 7s tick, giving one full retry cycle of slack before declaring
 * staleness. This is a config value (`DEFAULT_FRESHNESS_THRESHOLD_MS`),
 * injectable per-asset if a future asset class needs a different tolerance
 * (e.g. an asset with genuinely slower on-chain settlement).
 */
export const DEFAULT_FRESHNESS_THRESHOLD_MS = 15_000;

export interface MarketHours {
  /** IANA timezone the hours are expressed in, e.g. "America/New_York". */
  timezone: string;
  /** 24h "HH:mm" open time in that timezone. */
  open: string;
  /** 24h "HH:mm" close time in that timezone. */
  close: string;
  /** Days of week the market is open, 0=Sunday..6=Saturday. */
  daysOpen: number[];
}

/**
 * US equity regular session — used for AAPLx/METAx/NVDAx. GLDx is treated as
 * having no defined market hours here (commodity/ETF proxies can have
 * different or extended sessions depending on the actual underlying Pyth
 * feed used — see feed-registry.ts's GLD flag); USDG likewise has none
 * (24/7 by nature as a stablecoin peg). ⚠ Confirm this US-equity-hours
 * assumption is what Part A/B's asset registry actually wants encoded here
 * vs. reading it from a registry column — flagging as a build-time decision,
 * not a locked doc requirement (docs 01-08 don't specify per-asset market
 * hours data).
 */
export const US_EQUITY_MARKET_HOURS: MarketHours = {
  timezone: "America/New_York",
  open: "09:30",
  close: "16:00",
  daysOpen: [1, 2, 3, 4, 5],
};

export interface StalenessResult {
  isStale: boolean;
  /**
   * True when the asset has defined market hours, the market is currently
   * closed, and this price is being carried forward from the last real
   * observation rather than representing a fresh update (doc 05 §6 last
   * line: "distinguish fresh update from unchanged carry-forward price").
   * Carry-forward prices are NOT automatically stale — a closed market
   * correctly has no new data — but callers that want to distinguish "live"
   * from "last close" for display purposes can use this flag.
   */
  isCarryForward: boolean;
}

/**
 * Core staleness computation (doc 05 §6, locked):
 * - No price at all → caller handles as unavailable (staleness.ts only
 *   evaluates an existing observation's freshness, it doesn't invent one).
 * - Price older than the freshness threshold → stale, regardless of market
 *   hours (a stuck feed during market hours is exactly the case this rule
 *   exists to catch).
 * - Price older than threshold but market is currently closed AND the
 *   observation falls within the last session's close → NOT stale, marked
 *   carry-forward instead (a closed market has no new data by design, that's
 *   not the same failure mode as Pyth going down mid-session).
 */
export function computeStaleness(
  observedAt: Date,
  now: Date,
  freshnessThresholdMs: number,
  marketHours: MarketHours | null,
): StalenessResult {
  const ageMs = now.getTime() - observedAt.getTime();
  const withinThreshold = ageMs <= freshnessThresholdMs;

  if (withinThreshold) {
    return { isStale: false, isCarryForward: false };
  }

  if (marketHours && !isMarketOpen(now, marketHours)) {
    // Market closed and price is older than the threshold: this is an
    // expected carry-forward, not a failure — but it is still only valid as
    // "last known price," so it does NOT get marked isStale for display,
    // per doc 05 §6's carry-forward distinction. Condition evaluation
    // callers (Part C) should be aware that carry-forward prices, while not
    // `isStale`, also aren't a "new" observation — the engine's PRICE_PERCENT
    // ratchet logic in particular should not treat a carry-forward price as
    // a fresh baseline. Flagging this interaction for the manager thread /
    // Part C rather than asserting it's already handled correctly there.
    return { isStale: false, isCarryForward: true };
  }

  return { isStale: true, isCarryForward: false };
}

/**
 * Minimal, dependency-free market-hours check. Uses `Intl.DateTimeFormat`
 * (built into Node) rather than a date library, since this package has no
 * other need for one — keeps the freshness logic to zero runtime deps.
 */
export function isMarketOpen(now: Date, hours: MarketHours): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: hours.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "00";

  const day = weekdayMap[weekdayStr];
  if (day === undefined || !hours.daysOpen.includes(day)) return false;

  const nowMinutes = Number(hourStr) * 60 + Number(minuteStr);
  const [openH = 0, openM = 0] = hours.open.split(":").map(Number);
  const [closeH = 0, closeM = 0] = hours.close.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}
