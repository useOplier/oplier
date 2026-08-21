/**
 * Monitoring cadence (brief responsibility #13, LOCKED):
 * - Price / Price-percentage / ROI: 5-10s cycle.
 * - HIGH_IMPACT_NEWS: 60s cycle, do not tighten.
 * - TIME: scheduler-based (own interval here too, since nothing else drives it) — 30s
 *   granularity is enough for a condition whose param is HH:MM, and keeps this file's timer
 *   count small; tighten if the manager thread wants finer TIME resolution.
 *
 * Both numeric intervals are engine-level config, not per-System (brief: "not per-System"),
 * matching doc 04 §17's general principle, just with the price/ROI default tightened per
 * this brief's explicit override.
 */

import type { UpmEngine } from "./engine.js";

export interface EngineLoopConfig {
  priceDrivenIntervalMs: number; // 5000-10000
  newsIntervalMs: number; // 60000
  timeIntervalMs: number; // 30000, see note above
}

export const DEFAULT_ENGINE_LOOP_CONFIG: EngineLoopConfig = {
  priceDrivenIntervalMs: 7000,
  newsIntervalMs: 60000,
  timeIntervalMs: 30000,
};

export class EngineLoop {
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private engine: UpmEngine,
    private config: EngineLoopConfig = DEFAULT_ENGINE_LOOP_CONFIG,
    private onTickError: (err: unknown, cycle: "price" | "news" | "time") => void = (err, cycle) =>
      console.error(`[engine-loop] ${cycle} cycle error`, err),
  ) {}

  start(): void {
    /**
     * Runs `fn` on an interval, SKIPPING a tick while the previous one is still in flight.
     *
     * WHY: each cycle used to be a bare `setInterval(() => { this.engine.tickX().catch(...) })` with no
     * await and no guard. A price tick can take far longer than its own 7s interval — `attemptStep`
     * polls for a receipt for up to 45s — so ticks overlapped routinely, and concurrent ticks racing
     * the same step is how one (system, run, step) ended up submitting TWO on-chain swaps.
     *
     * `step-executor`'s `claimExecutionForAttempt` CAS is the authoritative guard (correctness must not
     * depend on scheduling), but overlapping ticks are still pure waste: duplicated queries, duplicated
     * evaluation, and contention. Skipping is right rather than queueing — a missed price tick is
     * superseded by the next one 7s later, so backing up stale work would be worse than dropping it.
     */
    const guarded = (fn: () => Promise<unknown>, cycle: "price" | "news" | "time", intervalMs: number) => {
      let inFlight = false;
      return setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        fn()
          .catch((err) => this.onTickError(err, cycle))
          .finally(() => {
            inFlight = false;
          });
      }, intervalMs);
    };

    this.timers.push(
      guarded(() => this.engine.tickPriceDriven(), "price", this.config.priceDrivenIntervalMs),
    );
    this.timers.push(guarded(() => this.engine.tickNews(), "news", this.config.newsIntervalMs));
    this.timers.push(guarded(() => this.engine.tickTime(), "time", this.config.timeIntervalMs));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}
