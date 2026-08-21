// =============================================================================
// src/pyth/stream-client.ts
//
// Thin abstraction over the Pyth SDK, so `PythAdapter` never imports
// `@pythnetwork/hermes-client` directly (same "mock everything external"
// discipline ENGINE_CONTRACT.md §1 uses for PermissionService/SwapExecutor).
// This is also what lets the adapter's own tests run with zero network
// access and zero installed Pyth SDK — `MockPythStreamClient` implements
// this interface without touching the real package at all.
// =============================================================================

export interface PythPriceUpdate {
  feedId: string;
  price: number;
  /** Pyth's own confidence interval, kept for future staleness/quality heuristics. */
  confidence: number;
  /** Unix ms — Pyth publishes seconds; adapter normalizes to ms at the boundary. */
  publishTimeMs: number;
}

/**
 * Provider-agnostic streaming/pull price source. `PythAdapter` depends on
 * this, not on a concrete SDK class — swapping Pyth for Chainlink later means
 * writing a new class satisfying this interface, not touching the adapter's
 * staleness/carry-forward/caching logic (doc 05 §3, locked requirement).
 */
export interface PythStreamClient {
  /** One-shot pull for a feed's latest known price (Hermes `/v2/updates/price/latest`). */
  getLatestPrice(feedId: string): Promise<PythPriceUpdate | null>;
  /**
   * Subscribe to the SSE/websocket stream for a set of feed ids (Hermes
   * `/v2/updates/price/stream`) — doc 05 §5 "consume the available stream
   * rather than unnecessarily polling at high frequency". Returns an
   * unsubscribe function.
   */
  subscribe(feedIds: string[], onUpdate: (update: PythPriceUpdate) => void): () => void;
}

/**
 * ⚠ VERIFY BEFORE BUILDING (brief, Part D): "confirm current recommended SDK
 * — `@pythnetwork/hermes-client` or successor — via Pyth's docs at build
 * time; SDK naming has churned, verify current." This class is written
 * against `@pythnetwork/hermes-client`'s documented shape as of this model's
 * training data. That package is not installed in this sandbox (no network),
 * so this file is excluded from the package's `tsconfig.json` the same way
 * `drizzle-adapter.ts` is — a reference implementation, not yet compiled or
 * run. Wire it up and run `tsc --noEmit` for real once the dependency can
 * actually be installed, and confirm the import path/method names against
 * whatever Pyth's docs say is current at that point.
 */
export class HermesStreamClient implements PythStreamClient {
  private readonly hermesEndpoint: string;

  constructor(opts: { hermesEndpoint?: string } = {}) {
    // Pyth's public Hermes endpoint as of training-data knowledge — confirm
    // current URL (and whether a dedicated/paid endpoint is warranted for
    // production reliability) against Pyth's docs before deploy.
    this.hermesEndpoint = opts.hermesEndpoint ?? "https://hermes.pyth.network";
  }

  async getLatestPrice(feedId: string): Promise<PythPriceUpdate | null> {
    // Sketch only — see class doc comment. Expected real implementation:
    //
    //   const { HermesClient } = await import("@pythnetwork/hermes-client");
    //   const client = new HermesClient(this.hermesEndpoint);
    //   const [feed] = await client.getLatestPriceUpdates([feedId]);
    //   if (!feed) return null;
    //   return {
    //     feedId,
    //     price: Number(feed.price.price) * 10 ** feed.price.expo,
    //     confidence: Number(feed.price.conf) * 10 ** feed.price.expo,
    //     publishTimeMs: feed.price.publish_time * 1000,
    //   };
    //
    // Not executed here — see file-level flag.
    throw new Error(
      "HermesStreamClient is a build-time reference sketch — see file header. " +
        "Wire the real @pythnetwork/hermes-client call once network/package access exists.",
    );
  }

  subscribe(_feedIds: string[], _onUpdate: (update: PythPriceUpdate) => void): () => void {
    // Sketch only. Expected real implementation opens Hermes'
    // `/v2/updates/price/stream` SSE endpoint (or the SDK's `wsClient`
    // equivalent, whichever Pyth's docs currently recommend) and calls
    // `onUpdate` normalized as above per event. Returns the SSE `close()` /
    // websocket teardown as the unsubscribe function.
    throw new Error(
      "HermesStreamClient.subscribe is a build-time reference sketch — see file header.",
    );
  }
}

/** Fully runnable, used by tests and local development without network access. */
export class MockPythStreamClient implements PythStreamClient {
  private latest = new Map<string, PythPriceUpdate>();
  private subscribers = new Map<string, Set<(u: PythPriceUpdate) => void>>();

  async getLatestPrice(feedId: string): Promise<PythPriceUpdate | null> {
    return this.latest.get(feedId) ?? null;
  }

  subscribe(feedIds: string[], onUpdate: (update: PythPriceUpdate) => void): () => void {
    for (const id of feedIds) {
      if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
      this.subscribers.get(id)!.add(onUpdate);
    }
    return () => {
      for (const id of feedIds) {
        this.subscribers.get(id)?.delete(onUpdate);
      }
    };
  }

  /** Test helper — pushes an update as if it arrived over the stream. */
  push(update: PythPriceUpdate): void {
    this.latest.set(update.feedId, update);
    for (const cb of this.subscribers.get(update.feedId) ?? []) {
      cb(update);
    }
  }
}
