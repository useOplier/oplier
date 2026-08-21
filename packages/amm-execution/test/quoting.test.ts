import { test } from "node:test";
import assert from "node:assert/strict";
import { getAmountOut, quoteAmountsOut } from "../src/quoting/quote.js";
import { resolveRoute } from "../src/routing/resolve-route.js";
import { MockChainReader } from "../src/testing/mock-chain.js";
import { SwapExecutionError } from "../src/types.js";
import { RWA_TOKENS, USDG_TOKEN } from "../src/config/assets.js";
import { POOLS } from "../src/config/deployment.js";

test("getAmountOut matches UniswapV2Library's reference formula (0.3% fee)", () => {
  // Classic textbook check: 1000/1000 reserves, 100 in -> ~90.6 out (not exactly 90 due to fee).
  const out = getAmountOut(100n, 1000n, 1000n);
  // amountInWithFee = 100*9970 = 997000; num = 997000*1000 = 997000000
  // den = 1000*10000 + 997000 = 10997000; out = 997000000/10997000 = 90 (floor)
  assert.equal(out, 90n);
});

test("getAmountOut throws NO_LIQUIDITY on zero reserves", () => {
  assert.throws(
    () => getAmountOut(100n, 0n, 0n),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "NO_LIQUIDITY",
  );
});

test("getAmountOut throws INVALID_AMOUNT on zero amountIn", () => {
  assert.throws(
    () => getAmountOut(0n, 1000n, 1000n),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "INVALID_AMOUNT",
  );
});

test("quoteAmountsOut against the real seeded AAPLx/USDG reserves (0.055 AAPLx + 11 USDG)", async () => {
  const chainReader = new MockChainReader();
  const aaplx = RWA_TOKENS.test_aapl;
  const usdg = USDG_TOKEN;
  const pairAddress = String(POOLS.test_aapl.pairAddress);

  // 0.055 AAPLx @ 18 decimals, 11 USDG @ 6 decimals — token0/token1 ordering by address per
  // real V2 semantics; addresses happen to sort AAPLx < USDG lexicographically is irrelevant
  // to the test, we set token0/token1 explicitly and let the reader resolve by address match.
  const aaplxReserve = 55_000_000_000_000_000n; // 0.055 * 1e18
  const usdgReserve = 11_000_000n; // 11 * 1e6
  chainReader.setReserves(pairAddress, aaplxReserve, usdgReserve, aaplx.tokenAddress, usdg.tokenAddress);

  const route = resolveRoute("test_aapl", "test_usdg");
  // Small demo-sized trade, per Part F brief point 7 ($10-25 range guidance — using a small
  // token-unit trade here since the pool itself only holds 0.055 AAPLx total).
  const tinyAmountIn = 1_000_000_000_000_000n; // 0.001 AAPLx
  const amounts = await quoteAmountsOut(chainReader, route, tinyAmountIn);

  assert.equal(amounts.length, 2);
  assert.equal(amounts[0], tinyAmountIn);
  assert.ok(amounts[1] > 0n, "expected a positive USDG output");
  // Sanity bound: output must be less than total USDG reserve (can never drain the whole pool).
  assert.ok(amounts[1] < usdgReserve);
});

test("quoteAmountsOut throws NO_LIQUIDITY against an unseeded (zero-reserve) pool", async () => {
  const chainReader = new MockChainReader();
  // Deliberately do NOT call setReserves — MockChainReader returns (0,0) for any pair it
  // hasn't been told about, matching a real never-seeded UniswapV2Pair.
  const gldx = RWA_TOKENS.test_gold;
  const usdg = USDG_TOKEN;
  const pairAddress = String(POOLS.test_gold.pairAddress);
  chainReader.setReserves(pairAddress, 0n, 0n, gldx.tokenAddress, usdg.tokenAddress);

  // Route resolution itself already rejects GLDx/USDG (status: EMPTY in static config) before
  // quoting is ever reached — this test exercises quoteAmountsOut directly against a
  // synthetic route to prove the *quoting layer* independently also refuses zero reserves,
  // in case static config and live state ever disagree (config says empty, chain confirms it).
  const route = resolveRouteBypassingStaticGate(pairAddress, gldx.tokenAddress, usdg.tokenAddress);
  await assert.rejects(
    () => quoteAmountsOut(chainReader, route, 1_000_000_000_000_000_000n),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "NO_LIQUIDITY",
  );
});

function resolveRouteBypassingStaticGate(pairAddress: string, tokenInAddress: string, tokenOutAddress: string) {
  return {
    assetPath: ["test_gold", "test_usdg"],
    addressPath: [tokenInAddress, tokenOutAddress],
    hops: [
      {
        pool: { assetId: "test_gold", pairAddress, status: "EMPTY" as const },
        tokenIn: { assetId: "test_gold", symbol: "GLDx", tokenAddress: tokenInAddress, decimals: 18 },
        tokenOut: { assetId: "test_usdg", symbol: "USDG", tokenAddress: tokenOutAddress, decimals: 6 },
      },
    ],
  };
}
