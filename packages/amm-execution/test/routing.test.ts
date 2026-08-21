import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute } from "../src/routing/resolve-route.js";
import { SwapExecutionError } from "../src/types.js";

test("direct route: seeded RWA -> USDG", () => {
  const route = resolveRoute("test_aapl", "test_usdg");
  assert.equal(route.assetPath.length, 2);
  assert.equal(route.hops.length, 1);
  assert.equal(route.hops[0].pool.status, "SEEDED");
});

test("direct route: USDG -> seeded RWA", () => {
  const route = resolveRoute("test_usdg", "test_aapl");
  assert.deepEqual(route.assetPath, ["test_usdg", "test_aapl"]);
});

test("USDG-hop route: two non-USDG assets both requires seeded pools on both hops", () => {
  assert.throws(
    () => resolveRoute("test_aapl", "test_gold"),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "NO_LIQUIDITY",
  );
});

test("empty pool (GLDx/USDG) is rejected pre-submission, non-retryable", () => {
  assert.throws(
    () => resolveRoute("test_gold", "test_usdg"),
    (err: unknown) => {
      if (!(err instanceof SwapExecutionError)) return false;
      assert.equal(err.reason, "NO_LIQUIDITY");
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("empty pool (METAx/USDG) is rejected pre-submission", () => {
  assert.throws(() => resolveRoute("test_usdg", "test_meta"), SwapExecutionError);
});

test("empty pool (NVDAx/USDG) is rejected pre-submission", () => {
  assert.throws(() => resolveRoute("test_nvda", "test_usdg"), SwapExecutionError);
});

test("unknown assetId throws UNKNOWN_ASSET", () => {
  assert.throws(
    () => resolveRoute("not_a_real_asset", "test_usdg"),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "UNKNOWN_ASSET",
  );
});

test("same source and destination throws INVALID_ROUTE", () => {
  assert.throws(
    () => resolveRoute("test_aapl", "test_aapl"),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "INVALID_ROUTE",
  );
});
