import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PythAdapter } from "../src/pyth/pyth-adapter.js";
import { MockPythStreamClient } from "../src/pyth/stream-client.js";
import { InMemoryPriceRepository } from "../src/repository/in-memory-repository.js";
import { PriceUnavailableError } from "../src/types.js";

function setup(now = new Date("2026-08-17T15:00:00Z")) {
  const repository = new InMemoryPriceRepository();
  const streamClient = new MockPythStreamClient();
  const adapter = new PythAdapter({
    streamClient,
    repository,
    clock: () => now,
    resolveFeedId: (assetId) => (assetId === "test_aapl" ? { feedId: "feed-aapl", underlying: "AAPL" } : null),
    marketHoursByAssetId: {}, // no market-hours distinction in these tests unless explicitly set
  });
  return { repository, streamClient, adapter, now };
}

describe("PythAdapter — engine-exact getCurrentPrice", () => {
  test("throws PriceUnavailableError when no price has ever arrived", async () => {
    const { adapter } = setup();
    await assert.rejects(() => adapter.getCurrentPrice("test_aapl"), PriceUnavailableError);
  });

  test("returns fresh price after a stream update", async () => {
    const { adapter, streamClient, now } = setup();
    adapter.startStreaming(["test_aapl"]);
    streamClient.push({ feedId: "feed-aapl", price: 202.5, confidence: 0.1, publishTimeMs: now.getTime() - 1000 });

    // handleUpdate is async/fire-and-forget from subscribe — give the microtask queue a tick.
    await new Promise((r) => setTimeout(r, 10));

    const result = await adapter.getCurrentPrice("test_aapl");
    assert.equal(result.price, 202.5);
    assert.equal(result.isStale, false);
  });

  test("marks price stale once older than the freshness threshold", async () => {
    const { adapter, streamClient, now } = setup();
    adapter.startStreaming(["test_aapl"]);
    // Published 60s before "now" — well past the 15s default threshold, no market hours configured.
    streamClient.push({ feedId: "feed-aapl", price: 200, confidence: 0.1, publishTimeMs: now.getTime() - 60_000 });
    await new Promise((r) => setTimeout(r, 10));

    const result = await adapter.getCurrentPrice("test_aapl");
    assert.equal(result.isStale, true);
  });

  test("never fabricates a price: non-finite stream values are dropped, not stored", async () => {
    const { adapter, streamClient, now } = setup();
    adapter.startStreaming(["test_aapl"]);
    streamClient.push({ feedId: "feed-aapl", price: Number.NaN, confidence: 0.1, publishTimeMs: now.getTime() });
    await new Promise((r) => setTimeout(r, 10));

    await assert.rejects(() => adapter.getCurrentPrice("test_aapl"), PriceUnavailableError);
  });

  test("never fabricates a price: non-positive stream values are dropped", async () => {
    const { adapter, streamClient, now } = setup();
    adapter.startStreaming(["test_aapl"]);
    streamClient.push({ feedId: "feed-aapl", price: 0, confidence: 0.1, publishTimeMs: now.getTime() });
    await new Promise((r) => setTimeout(r, 10));

    await assert.rejects(() => adapter.getCurrentPrice("test_aapl"), PriceUnavailableError);
  });
});

describe("PythAdapter — getCurrentPriceDetailed (non-engine callers)", () => {
  test("returns { unavailable: true } instead of throwing", async () => {
    const { adapter } = setup();
    const result = await adapter.getCurrentPriceDetailed("test_aapl");
    assert.deepEqual(result, {
      unavailable: true,
      reason: "no cached price exists and no live observation has arrived yet",
    });
  });

  test("returns full detail shape (source, Date timestamp, isCarryForward) once a price exists", async () => {
    const { adapter, streamClient, now } = setup();
    adapter.startStreaming(["test_aapl"]);
    streamClient.push({ feedId: "feed-aapl", price: 202.5, confidence: 0.1, publishTimeMs: now.getTime() - 1000 });
    await new Promise((r) => setTimeout(r, 10));

    const result = await adapter.getCurrentPriceDetailed("test_aapl");
    assert.equal("unavailable" in result, false);
    if (!("unavailable" in result)) {
      assert.equal(result.price, 202.5);
      assert.equal(result.source, "pyth");
      assert.ok(result.timestamp instanceof Date);
      assert.equal(result.isStale, false);
      assert.equal(result.isCarryForward, false);
    }
  });
});

describe("PythAdapter — historical prices", () => {
  test("returns points within range from the append-only history log", async () => {
    const { adapter, repository } = setup();
    await repository.appendHistory({ assetId: "test_aapl", price: 200, observedAt: new Date("2026-08-17T14:00:00Z"), source: "pyth" });
    await repository.appendHistory({ assetId: "test_aapl", price: 201, observedAt: new Date("2026-08-17T14:30:00Z"), source: "pyth" });
    await repository.appendHistory({ assetId: "test_aapl", price: 300, observedAt: new Date("2026-08-16T14:00:00Z"), source: "pyth" }); // out of range

    const points = await adapter.getHistoricalPrices("test_aapl", {
      from: new Date("2026-08-17T00:00:00Z"),
      to: new Date("2026-08-17T23:59:59Z"),
    });

    assert.equal(points.length, 2);
    assert.deepEqual(
      points.map((p) => p.price),
      [200, 201],
    );
  });
});

describe("PythAdapter — USDG peg-check fallback", () => {
  test("returns synthetic $1.00 when no real observation exists", async () => {
    const repository = new InMemoryPriceRepository();
    const adapter = new PythAdapter({
      streamClient: new MockPythStreamClient(),
      repository,
      resolveFeedId: () => null,
    });
    const result = await adapter.getCurrentPrice("test_usdg");
    assert.equal(result.price, 1.0);
    assert.equal(result.isStale, false);
  });

  test("defers to a real cached peg-check observation when one exists", async () => {
    const repository = new InMemoryPriceRepository();
    const now = new Date("2026-08-17T15:00:00Z");
    await repository.upsertLatestPrice({
      assetId: "test_usdg",
      price: 0.998,
      source: "pyth",
      observedAt: new Date(now.getTime() - 5_000),
      isStale: false,
      updatedAt: now,
    });
    const adapter = new PythAdapter({
      streamClient: new MockPythStreamClient(),
      repository,
      clock: () => now,
      resolveFeedId: () => null,
    });
    const result = await adapter.getCurrentPrice("test_usdg");
    assert.equal(result.price, 0.998);
    assert.equal(result.isStale, false);
  });
});
