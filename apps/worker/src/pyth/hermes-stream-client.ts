import { HermesClient } from "@pythnetwork/hermes-client";
import type { PythPriceUpdate, PythStreamClient } from "@oplier/data-layer";
import type { Logger } from "../lib/logger.js";

/**
 * REAL Pyth Hermes stream client — the implementation `@oplier/data-layer`'s own
 * `HermesStreamClient` never had.
 *
 * That class is a documented reference sketch whose two methods both `throw new Error("...build-time
 * reference sketch...")`, and it is excluded from data-layer's tsconfig, so nothing in the repo
 * could actually obtain a Pyth price. Since `PythAdapter` depends only on the `PythStreamClient`
 * interface (doc 05 §3's provider-agnostic requirement), the real implementation can live here in
 * the worker without touching adapter logic — which is also where the master plan puts connecting
 * infrastructure.
 *
 * Verified against the installed `@pythnetwork/hermes-client@2.1.0`:
 *   - `new HermesClient(endpoint)`
 *   - `getLatestPriceUpdates(ids, { parsed: true })` -> `{ parsed: [{ id, price: { price, conf,
 *     expo, publish_time } }] }`
 *   - `getPriceUpdatesStream(ids, { parsed: true })` -> `Promise<EventSource>` (SSE)
 * The method names in data-layer's sketch comment were correct; the normalization below
 * (`Number(price) * 10 ** expo`) matches what that comment described.
 *
 * THIS CLIENT'S STREAMING PATH HAS NOT YET BEEN RUN AGAINST LIVE HERMES — no network access existed
 * while writing it, and the 2026-08-19 feed-id verification was done with direct HTTP calls to
 * Hermes' /v2 endpoints, not by exercising this SSE client. The feed IDs it subscribes with are now
 * verified (see data-layer's `feed-registry.ts`); the reconnect/parse logic below is not.
 * `preflight.ts` re-checks every configured feed against Hermes' real registry before the worker
 * will start.
 */

/** Pyth publishes prices as an integer plus a decimal exponent; this recovers the real value. */
function normalizePrice(rawPrice: string, expo: number): number {
  return Number(rawPrice) * 10 ** expo;
}

/** Hermes returns feed ids without the `0x` prefix; callers may configure either form. */
function stripHexPrefix(id: string): string {
  return id.startsWith("0x") ? id.slice(2) : id;
}

interface ParsedPriceFeed {
  id: string;
  price: { price: string; conf: string; expo: number; publish_time: number };
}

export interface HermesStreamClientDeps {
  endpoint: string;
  logger: Logger;
  /** Delay before re-opening a stream that closed. Kept modest — a dead price feed stalls every
   *  price/ROI condition, so reconnecting quickly matters more than backing off politely. */
  reconnectDelayMs?: number;
  /**
   * How long the stream may go with NO parsed update before it is treated as dead and force-reopened.
   *
   * WHY A DATA-FLOW WATCHDOG AND NOT `readyState`: relying on `readyState` is exactly what broke.
   * `onerror` only re-connected on `readyState === 2` (CLOSED), but the observed failure fired
   * `stream_error` every ~3.5s with `readyState: 0` (CONNECTING) — a connect that never completes and
   * never transitions to CLOSED. So the handler logged forever and nothing reconnected:
   * `asset_prices` went 17+ hours without a row while Hermes itself was healthy (a raw `curl -sN` on
   * the same SSE URL streamed data fine). No prices means no condition ever evaluates, which means the
   * worker silently never trades — the worst failure mode there is.
   *
   * Liveness measured as "did a frame arrive" is immune to whatever `readyState` happens to report.
   * Hermes pushes far more often than this, so 45s means genuinely dead, not merely quiet.
   */
  staleTimeoutMs?: number;
}

export class RealHermesStreamClient implements PythStreamClient {
  private readonly client: HermesClient;
  private readonly logger: Logger;
  private readonly reconnectDelayMs: number;
  private readonly staleTimeoutMs: number;
  private closed = false;
  private readonly openSources = new Set<EventSource>();
  private readonly pendingReconnects = new Set<ReturnType<typeof setTimeout>>();
  private readonly watchdogs = new Set<ReturnType<typeof setInterval>>();

  constructor(deps: HermesStreamClientDeps) {
    this.client = new HermesClient(deps.endpoint);
    this.logger = deps.logger.child({ component: "hermes" });
    this.reconnectDelayMs = deps.reconnectDelayMs ?? 2_000;
    this.staleTimeoutMs = deps.staleTimeoutMs ?? 45_000;
  }

  async getLatestPrice(feedId: string): Promise<PythPriceUpdate | null> {
    const id = stripHexPrefix(feedId);
    const update = await this.client.getLatestPriceUpdates([id], { parsed: true });
    const parsed = (update.parsed ?? []) as unknown as ParsedPriceFeed[];
    const feed = parsed[0];
    if (!feed) return null;
    return {
      feedId: stripHexPrefix(feed.id),
      price: normalizePrice(feed.price.price, feed.price.expo),
      confidence: normalizePrice(feed.price.conf, feed.price.expo),
      publishTimeMs: feed.price.publish_time * 1000,
    };
  }

  /**
   * Opens Hermes' SSE stream for `feedIds` and forwards every parsed update.
   *
   * Returns synchronously (the interface requires a plain unsubscribe function) while the stream
   * opens in the background — so a slow or failed initial connect can't block worker startup. A
   * failure to open is logged and retried rather than thrown, because throwing here would kill the
   * whole worker over a transient Hermes hiccup, taking condition evaluation for every System with
   * it.
   */
  subscribe(feedIds: string[], onUpdate: (update: PythPriceUpdate) => void): () => void {
    const ids = feedIds.map(stripHexPrefix);
    let currentSource: EventSource | undefined;

    /** Last time a frame actually arrived — the only trustworthy liveness signal. See `staleTimeoutMs`. */
    let lastActivityAt = Date.now();
    /** Guards against a reconnect storm: many `onerror` calls must collapse into one re-open. */
    let reconnecting = false;

    /**
     * Tears down the current source and re-opens, regardless of what `readyState` claims.
     *
     * Single-flight on purpose: `onerror` fired every ~3.5s in the observed failure, and one re-open
     * per error would pile up concurrent streams all writing the same prices.
     */
    const forceReconnect = (reason: string): void => {
      if (this.closed || reconnecting) return;
      reconnecting = true;
      this.logger.warn("stream_force_reconnect", { reason, feedCount: ids.length });
      if (currentSource) {
        this.openSources.delete(currentSource);
        try {
          currentSource.close();
        } catch {
          // Already dead — closing a broken source must not mask the reconnect.
        }
        currentSource = undefined;
      }
      scheduleReconnect();
    };

    const open = async (): Promise<void> => {
      if (this.closed) return;

      // NOTE: there is deliberately no `typeof EventSource === "undefined"` guard here any more.
      // It used to bail out at this point, which silently disabled the price stream — and therefore
      // every price/ROI condition — on any runtime without a *global* EventSource. That guard was
      // simply wrong: `@pythnetwork/hermes-client` declares `eventsource@^3.0.5` as a real
      // dependency and imports `EventSource` from it (see its `hermes-client.mjs` line 1), so the
      // SSE path never touched the global at all. Node only exposes a global EventSource behind
      // `--experimental-eventsource` (still true on v24), so the guard fired on healthy hosts and
      // produced exactly the failure mode the runbook calls the worst possible one: a worker that
      // looks started and never fires a condition.
      try {
        const source = await this.client.getPriceUpdatesStream(ids, {
          parsed: true,
          // Ordered updates only: an out-of-order price would move the PRICE_PERCENT baseline
          // backwards and could fire a condition off a stale observation.
          allowUnordered: false,
          // Ask Hermes to skip ids it doesn't recognise rather than rejecting the whole
          // subscription — one bad feed id (see feed-registry.ts's flagged entries) must not take
          // down pricing for every other asset. `preflight.ts` is what surfaces the bad id loudly.
          ignoreInvalidPriceIds: true,
        });
        if (this.closed) {
          source.close();
          return;
        }
        currentSource = source;
        this.openSources.add(source);
        reconnecting = false;
        lastActivityAt = Date.now();
        this.logger.info("stream_open", { feedCount: ids.length });

        source.onmessage = (event: MessageEvent) => {
          lastActivityAt = Date.now();
          try {
            const payload = JSON.parse(String(event.data)) as { parsed?: ParsedPriceFeed[] };
            for (const feed of payload.parsed ?? []) {
              onUpdate({
                feedId: stripHexPrefix(feed.id),
                price: normalizePrice(feed.price.price, feed.price.expo),
                confidence: normalizePrice(feed.price.conf, feed.price.expo),
                publishTimeMs: feed.price.publish_time * 1000,
              });
            }
          } catch (err) {
            // A single malformed frame must not tear down the stream.
            this.logger.warn("stream_frame_parse_failed", { err });
          }
        };

        source.onerror = () => {
          // `readyState` is reported but NOT trusted for the reconnect decision — see `staleTimeoutMs`
          // for why the old `=== 2` check silently wedged the stream for 17 hours. CLOSED is acted on
          // immediately because it is unambiguous; a stuck CONNECTING (0) is left to the watchdog, so
          // a stream that really is mid-recovery gets a chance to finish on its own.
          this.logger.warn("stream_error", { readyState: source.readyState });
          if (source.readyState === 2 /* CLOSED */) forceReconnect("readyState=CLOSED");
        };
      } catch (err) {
        this.logger.error("stream_open_failed", { err });
        reconnecting = false;
        scheduleReconnect();
      }
    };

    const scheduleReconnect = (): void => {
      if (this.closed) return;
      const timer = setTimeout(() => {
        this.pendingReconnects.delete(timer);
        void open();
      }, this.reconnectDelayMs);
      this.pendingReconnects.add(timer);
    };

    void open();

    /**
     * Independent liveness check. Whatever `readyState` says, and whether or not `onerror` ever fires,
     * a stream that has delivered nothing for `staleTimeoutMs` is dead and gets re-opened.
     */
    const watchdog = setInterval(() => {
      if (this.closed) return;
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs > this.staleTimeoutMs) {
        // `readyState` is logged (not acted on) because it is the one thing that distinguishes the two
        // very different causes of silence: 1/OPEN means connected-but-no-data, 0/CONNECTING means the
        // connect never completed — on this host that was IPv6 attempts failing with ENETUNREACH.
        this.logger.warn("stream_stale", {
          idleMs,
          staleTimeoutMs: this.staleTimeoutMs,
          readyState: currentSource?.readyState ?? "no-source",
        });
        forceReconnect(`no frames for ${idleMs}ms`);
      }
    }, Math.max(5_000, Math.floor(this.staleTimeoutMs / 3)));
    this.watchdogs.add(watchdog);

    return () => {
      clearInterval(watchdog);
      this.watchdogs.delete(watchdog);
      if (currentSource) {
        this.openSources.delete(currentSource);
        currentSource.close();
      }
    };
  }

  /** Closes every open stream and cancels pending reconnects — called on worker shutdown. */
  close(): void {
    this.closed = true;
    for (const timer of this.pendingReconnects) clearTimeout(timer);
    this.pendingReconnects.clear();
    // Watchdogs are intervals, so leaving even one behind keeps the event loop alive and prevents the
    // process from exiting — which is exactly the class of hang that made shutdown unkillable.
    for (const watchdog of this.watchdogs) clearInterval(watchdog);
    this.watchdogs.clear();
    for (const source of this.openSources) source.close();
    this.openSources.clear();
  }
}
