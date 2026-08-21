import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAmountOutMin, assertMeetsMinimumOutput } from "../src/slippage/slippage.js";
import { SwapExecutionError } from "../src/types.js";

test("computeAmountOutMin: 1% default slippage on 50 tAAPL -> 49.5", () => {
  // Mirrors full_specifications.txt §13's worked example exactly (scaled to base units).
  const quoted = 50_000_000_000_000_000_000n; // 50 * 1e18
  const min = computeAmountOutMin(quoted, 100); // 100 bps = 1%
  assert.equal(min, 49_500_000_000_000_000_000n); // 49.5 * 1e18
});

test("computeAmountOutMin: 0 bps slippage requires exact quoted output", () => {
  const quoted = 1000n;
  assert.equal(computeAmountOutMin(quoted, 0), 1000n);
});

test("computeAmountOutMin rejects out-of-range bps", () => {
  assert.throws(
    () => computeAmountOutMin(1000n, 10_001),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "INVALID_SLIPPAGE",
  );
  assert.throws(() => computeAmountOutMin(1000n, -1), SwapExecutionError);
});

test("assertMeetsMinimumOutput passes when fresh quote is at or above the minimum", () => {
  assert.doesNotThrow(() => assertMeetsMinimumOutput(100n, 100n));
  assert.doesNotThrow(() => assertMeetsMinimumOutput(101n, 100n));
});

test("assertMeetsMinimumOutput throws a retryable, non-submitted error when below minimum (never auto-widens)", () => {
  assert.throws(
    () => assertMeetsMinimumOutput(99n, 100n),
    (err: unknown) => {
      if (!(err instanceof SwapExecutionError)) return false;
      assert.equal(err.reason, "SLIPPAGE_PRECHECK_FAILED");
      assert.equal(err.retryable, true);
      return true;
    },
  );
});
