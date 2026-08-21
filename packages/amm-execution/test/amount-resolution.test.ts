import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAmountIn, parseDecimalToBaseUnits, InMemoryRunStartBalanceStore } from "../src/amounts/resolve-amount.js";
import { MockChainReader } from "../src/testing/mock-chain.js";
import { RWA_TOKENS } from "../src/config/assets.js";
import { SwapExecutionError, type SwapParams } from "../src/types.js";

function baseParams(overrides: Partial<SwapParams> = {}): SwapParams {
  return {
    executionId: "exec-1",
    runId: "run-1",
    sourceAsset: "test_aapl",
    destinationAsset: "test_usdg",
    amountType: "FIXED",
    amountValue: "1",
    maxSlippageBps: 100,
    permissionRef: "perm-1",
    walletAddress: "0xWallet",
    deadline: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

test("parseDecimalToBaseUnits: whole number", () => {
  assert.equal(parseDecimalToBaseUnits("10", 18), 10_000_000_000_000_000_000n);
});

test("parseDecimalToBaseUnits: fractional, truncates beyond decimals", () => {
  assert.equal(parseDecimalToBaseUnits("0.0551234567890123456789", 18), 55_123_456_789_012_345n);
});

test("parseDecimalToBaseUnits: rejects negative/garbage input", () => {
  assert.throws(() => parseDecimalToBaseUnits("-1", 18), SwapExecutionError);
  assert.throws(() => parseDecimalToBaseUnits("abc", 18), SwapExecutionError);
  assert.throws(() => parseDecimalToBaseUnits("0", 18), SwapExecutionError);
});

test("resolveAmountIn: FIXED resolves against sourceAsset decimals directly", async () => {
  const chainReader = new MockChainReader();
  const store = new InMemoryRunStartBalanceStore();
  const amountIn = await resolveAmountIn(
    baseParams({ amountType: "FIXED", amountValue: "0.001" }),
    { chainReader, runStartBalanceStore: store },
  );
  assert.equal(amountIn, 1_000_000_000_000_000n); // 0.001 * 1e18
});

test("resolveAmountIn: CURRENT_BALANCE_PERCENT reads live balance at call time", async () => {
  const chainReader = new MockChainReader();
  const store = new InMemoryRunStartBalanceStore();
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 200_000_000_000_000_000n); // 0.2 AAPLx

  const amountIn = await resolveAmountIn(
    baseParams({ amountType: "CURRENT_BALANCE_PERCENT", amountValue: "50" }),
    { chainReader, runStartBalanceStore: store },
  );
  assert.equal(amountIn, 100_000_000_000_000_000n); // 50% of 0.2
});

test("resolveAmountIn: SYSTEM_START_BALANCE_PERCENT snapshots once, ignores later balance changes within the same run", async () => {
  const chainReader = new MockChainReader();
  const store = new InMemoryRunStartBalanceStore();
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 100_000_000_000_000_000n); // 0.1 AAPLx at run start

  const first = await resolveAmountIn(
    baseParams({ amountType: "SYSTEM_START_BALANCE_PERCENT", amountValue: "50" }),
    { chainReader, runStartBalanceStore: store },
  );
  assert.equal(first, 50_000_000_000_000_000n); // 50% of 0.1

  // Balance changes mid-run (e.g. a prior step already swapped some away) — the snapshot
  // must NOT move for a later step in the same run.
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 10_000_000_000_000_000n);
  const second = await resolveAmountIn(
    baseParams({ amountType: "SYSTEM_START_BALANCE_PERCENT", amountValue: "50" }),
    { chainReader, runStartBalanceStore: store },
  );
  assert.equal(second, 50_000_000_000_000_000n, "must reuse the run-start snapshot, not re-read live balance");
});

test("resolveAmountIn: SYSTEM_START_BALANCE_PERCENT snapshots independently per runId", async () => {
  const chainReader = new MockChainReader();
  const store = new InMemoryRunStartBalanceStore();
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 100_000_000_000_000_000n);
  await resolveAmountIn(baseParams({ runId: "run-1", amountType: "SYSTEM_START_BALANCE_PERCENT", amountValue: "10" }), {
    chainReader,
    runStartBalanceStore: store,
  });

  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 400_000_000_000_000_000n);
  const runTwoAmount = await resolveAmountIn(
    baseParams({ runId: "run-2", amountType: "SYSTEM_START_BALANCE_PERCENT", amountValue: "10" }),
    { chainReader, runStartBalanceStore: store },
  );
  assert.equal(runTwoAmount, 40_000_000_000_000_000n, "run-2's snapshot should be its own, independent of run-1's");
});

test("resolveAmountIn: percent amount that resolves to zero balance throws INVALID_AMOUNT", async () => {
  const chainReader = new MockChainReader();
  const store = new InMemoryRunStartBalanceStore();
  await assert.rejects(
    () =>
      resolveAmountIn(baseParams({ amountType: "CURRENT_BALANCE_PERCENT", amountValue: "50" }), {
        chainReader,
        runStartBalanceStore: store,
      }),
    (err: unknown) => err instanceof SwapExecutionError && err.reason === "INVALID_AMOUNT",
  );
});
