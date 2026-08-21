// =============================================================================
// src/pyth/pyth-adapter.ts — Part D core deliverable.
//
// Implements TWO interfaces on one class (see DATA_LAYER_CONTRACT.md §1 for
// the full reconciliation of why):
//   - `PriceDataProvider` (types.ts) — engine-exact, matches ENGINE_CONTRACT.md
//     §1 verbatim. `getCurrentPrice` throws `PriceUnavailableError` rather
//     than returning a value when nothing valid exists, since that narrower
//     type has no way to express "unavailable" as data.
//   - `PriceDataProviderDetailed` (types.ts) — the brief's fuller sketch, for
//     non-engine callers (apps/api routes, chart/audit-trail reads). Returns
//     the `{ unavailable: true, reason }` union member instead of throwing.
// =============================================================================

import type {
  DetailedPriceResult,
  PriceDataProvider,
  PriceDataProviderDetailed,
  PricePoint,
} from "../types.js";
import { PriceUnavailableError } from "../types.js";
import { resolveFeedIdFromLocalRegistry } from "./feed-registry.js";
import type { PriceRepository } from "../repository/types.js";
import { computeStaleness, DEFAULT_FRESHNESS_THRESHOLD_MS, US_EQUITY_MARKET_HOURS } from "./staleness.js";
import type { MarketHours } from "./staleness.js";
import type { PythStreamClient } from "./stream-client.js";

export interface PythAdapterDeps {
  streamClient: PythStreamClient;
  repository: PriceRepository;
  /** Injected so tests control "now" deterministically. Defaults to `() => new Date()`. */
  clock?: () => Date;
  freshnessThresholdMs?: number;
  /** Overridable so the real registry-backed lookup can replace the local fallback (see feed-registry.ts). */
  resolveFeedId?: (assetId: string) => { feedId: string; underlying: string } | null;
  /** Per-asset market hours; assets absent from this map are treated as having no defined hours (24/7, e.g. USDG). */
  marketHoursByAssetId?: Record<string, MarketHours>;
}

/**
 * Asset ids are `asset_registry.asset_id` values (see feed-registry.ts's ASSET ID CORRECTION
 * note) — `test_gold`/`test_usdg`, not `test_gld`/`usdg`.
 */
const DEFAULT_MARKET_HOURS_BY_ASSET: Record<string, MarketHours> = {
  test_aapl: US_EQUITY_MARKET_HOURS,
  test_meta: US_EQUITY_MARKET_HOURS,
  test_nvda: US_EQUITY_MARKET_HOURS,
  // test_gold intentionally omitted — see staleness.ts's GLD market-hours flag.
  // test_usdg intentionally omitted — stablecoin, no session concept.
};

/** `asset_registry.asset_id` of the settlement stablecoin — see feed-registry.ts's correction note. */
const USDG_ASSET_ID = "test_usdg";

export class PythAdapter implements PriceDataProvider, PriceDataProviderDetailed {
  private readonly clock: () => Date;
  private readonly freshnessThresholdMs: number;
  private readonly resolveFeedId: (assetId: string) => { feedId: string; underlying: string } | null;
  private readonly marketHoursByAssetId: Record<string, MarketHours>;
  private readonly streamClient: PythStreamClient;
  private readonly repository: PriceRepository;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(deps: PythAdapterDeps) {
    this.streamClient = deps.streamClient;
    this.repository = deps.repository;
    this.clock = deps.clock ?? (() => new Date());
    this.freshnessThresholdMs = deps.freshnessThresholdMs ?? DEFAULT_FRESHNESS_THRESHOLD_MS;
    this.resolveFeedId = deps.resolveFeedId ?? resolveFeedIdFromLocalRegistry;
    this.marketHoursByAssetId = deps.marketHoursByAssetId ?? DEFAULT_MARKET_HOURS_BY_ASSET;
  }

  /**
   * Start consuming the stream for the given assets (doc 05 §5 — stream, not
   * polling). Every update is normalized, written to the "latest" cache, and
   * appended to history (doc 05 §5: "The application does not need to write
   * every Pyth update onto testnet" — this writes to Postgres, not on-chain,
   * so that constraint doesn't apply here; it's about avoiding needless
   * on-chain writes, not needless DB writes).
   */
  startStreaming(assetIds: string[]): void {
    const feedIdToAssetId = new Map<string, string>();
    for (const assetId of assetIds) {
      const entry = this.resolveFeedId(assetId);
      if (!entry || !entry.feedId) continue; // e.g. USDG with no resolved feed — see feed-registry.ts flag.
      feedIdToAssetId.set(entry.feedId, assetId);
    }

    const feedIds = [...feedIdToAssetId.keys()];
    if (feedIds.length === 0) return;

    const unsubscribe = this.streamClient.subscribe(feedIds, (update) => {
      const assetId = feedIdToAssetId.get(update.feedId);
      if (!assetId) return;
      void this.handleUpdate(assetId, update.price, new Date(update.publishTimeMs));
    });
    this.unsubscribers.push(unsubscribe);
  }

  stopStreaming(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
  }

  /**
   * One-shot REST refresh for the given assets, as a BACKSTOP behind `startStreaming`.
   *
   * WHY THIS IS NEEDED and why it is not "unnecessary polling" (doc 05 §5 prefers the stream, and the
   * stream is still the primary path): the SSE stream was observed delivering a single burst of frames
   * on connect and then going quiet. The tell was that all four assets shared a byte-identical
   * `observed_at` (15:45:46, and before that 15:01:21) — four independent Pyth feeds never publish in
   * lockstep, so those rows were one batch, not a live feed. `asset_prices` consequently went minutes
   * (overnight, 17+ hours) between writes while `getCurrentPrice` measured staleness against wall
   * clock, so EVERY price condition evaluated false on staleness and no System ever fired. Silently:
   * staleness is not an error, so nothing was logged.
   *
   * Called on the worker's existing price cycle, so the write cadence is bounded by that cycle no
   * matter how the stream behaves. Failures per asset are swallowed deliberately — a REST hiccup must
   * not take down the cycle, and the stream may well have already supplied a fresher value.
   */
  async refreshLatestPrices(assetIds: string[]): Promise<void> {
    for (const assetId of assetIds) {
      const entry = this.resolveFeedId(assetId);
      if (!entry?.feedId) continue; // e.g. USDG — peg-check path, no Pyth feed.
      try {
        const update = await this.streamClient.getLatestPrice(entry.feedId);
        if (!update) continue;
        await this.handleUpdate(assetId, update.price, new Date(update.publishTimeMs));
      } catch {
        // Intentionally ignored — see method doc.
      }
    }
  }

  private async handleUpdate(assetId: string, price: number, observedAt: Date): Promise<void> {
    // Never fabricate a price (brief, "Never fabricate a price"): a rejected
    // or non-finite value from the stream is dropped, not written.
    if (!Number.isFinite(price) || price <= 0) return;

    await this.repository.upsertLatestPrice({
      assetId,
      price,
      source: "pyth",
      observedAt,
      isStale: false, // freshness is computed at READ time, not write time — see getCurrentPrice*.
      updatedAt: this.clock(),
    });
    await this.repository.appendHistory({ assetId, price, observedAt, source: "pyth" });
  }

  /** Engine-exact method — matches ENGINE_CONTRACT.md §1's `PriceDataProvider`. */
  async getCurrentPrice(assetId: string): Promise<{ price: number; timestamp: number; isStale: boolean }> {
    const cached = await this.repository.getLatestPrice(assetId);

    if (assetId.toLowerCase() === USDG_ASSET_ID || this.resolveFeedId(assetId)?.underlying === "USDG") {
      return this.getPegCheckPrice(assetId, cached);
    }

    if (!cached) {
      throw new PriceUnavailableError(assetId, "no cached price exists and no live observation has arrived yet");
    }

    const { isStale } = computeStaleness(
      cached.observedAt,
      this.clock(),
      this.freshnessThresholdMs,
      this.marketHoursByAssetId[assetId] ?? null,
    );

    return { price: cached.price, timestamp: cached.observedAt.getTime(), isStale };
  }

  /** Non-engine callers — brief's fuller shape, never throws. */
  async getCurrentPriceDetailed(assetId: string): Promise<DetailedPriceResult> {
    try {
      const cached = await this.repository.getLatestPrice(assetId);
      if (!cached) {
        return { unavailable: true, reason: "no cached price exists and no live observation has arrived yet" };
      }
      const { isStale, isCarryForward } = computeStaleness(
        cached.observedAt,
        this.clock(),
        this.freshnessThresholdMs,
        this.marketHoursByAssetId[assetId] ?? null,
      );
      return {
        price: cached.price,
        timestamp: cached.observedAt,
        isStale,
        source: "pyth",
        isCarryForward,
      };
    } catch (err) {
      if (err instanceof PriceUnavailableError) {
        return { unavailable: true, reason: err.message };
      }
      throw err;
    }
  }

  async getHistoricalPrices(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]> {
    return this.repository.getHistory(assetId, range);
  }

  /**
   * USDG peg-check fallback (brief's open question — see feed-registry.ts
   * `usdg` entry). Until it's confirmed whether Pyth publishes a USDG/USD
   * feed, USDG is treated as a stablecoin pegged 1:1 to USD by product
   * definition: `getCurrentPrice` returns a synthetic $1.00 with
   * `isStale: false` UNLESS a real peg-check observation exists in the
   * repository (written by a — not-yet-built — peg monitor that would flag
   * de-peg events), in which case that real observation's staleness applies
   * instead. This is a deliberate "don't fabricate, but don't leave a core
   * stablecoin asset with no price at all either" compromise — flagged
   * explicitly rather than silently hardcoding $1.00 with no escape hatch.
   */
  private async getPegCheckPrice(
    assetId: string,
    cached: Awaited<ReturnType<PriceRepository["getLatestPrice"]>>,
  ): Promise<{ price: number; timestamp: number; isStale: boolean }> {
    if (cached) {
      const { isStale } = computeStaleness(cached.observedAt, this.clock(), this.freshnessThresholdMs, null);
      return { price: cached.price, timestamp: cached.observedAt.getTime(), isStale };
    }
    return { price: 1.0, timestamp: this.clock().getTime(), isStale: false };
  }
}
