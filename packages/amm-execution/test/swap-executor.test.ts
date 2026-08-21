import { test } from "node:test";
import assert from "node:assert/strict";
import { AmmSwapExecutor } from "../src/execution/swap-executor.js";
import { MockChainReader, MockSessionKeyTransactionSender, RecordingCalldataEncoder } from "../src/testing/mock-chain.js";
import { InMemoryRunStartBalanceStore } from "../src/amounts/resolve-amount.js";
import { RWA_TOKENS, USDG_TOKEN } from "../src/config/assets.js";
import { POOLS } from "../src/config/deployment.js";
import { SwapExecutionError, type SwapParams } from "../src/types.js";

function makeExecutor() {
  const chainReader = new MockChainReader();
  const sessionSender = new MockSessionKeyTransactionSender();
  const calldataEncoder = new RecordingCalldataEncoder();
  const runStartBalanceStore = new InMemoryRunStartBalanceStore();
  const executor = new AmmSwapExecutor({ chainReader, sessionSender, calldataEncoder, runStartBalanceStore });
  return { executor, chainReader, sessionSender, calldataEncoder };
}

function seedAaplxUsdgPool(chainReader: MockChainReader) {
  chainReader.setReserves(
    String(POOLS.test_aapl.pairAddress),
    55_000_000_000_000_000n, // 0.055 AAPLx
    11_000_000n, // 11 USDG
    RWA_TOKENS.test_aapl.tokenAddress,
    USDG_TOKEN.tokenAddress,
  );
}

function swapParams(overrides: Partial<SwapParams> = {}): SwapParams {
  return {
    executionId: "exec-1",
    runId: "run-1",
    sourceAsset: "test_aapl",
    destinationAsset: "test_usdg",
    amountType: "FIXED",
    amountValue: "0.001",
    maxSlippageBps: 100, // 1%, MVP default per full_specifications.txt §13
    permissionRef: "perm-ref-1",
    walletAddress: "0xWallet",
    deadline: new Date(Date.now() + 5 * 60_000),
    ...overrides,
  };
}

test("happy path: seeded AAPLx/USDG swap submits, then resolves SUCCESS on receipt", async () => {
  const { executor, chainReader, sessionSender, calldataEncoder } = makeExecutor();
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);

  sessionSender.setNextOutcome({ kind: "success", amount0Out: 0n, amount1Out: 1n }, String(POOLS.test_aapl.pairAddress));

  const submitted = await executor.executeSwap(swapParams());
  assert.equal(submitted.status, "PENDING");
  assert.ok(submitted.txHash.startsWith("0x"));
  assert.ok(calldataEncoder.lastCall, "expected the Router call to have been encoded");
  assert.equal(calldataEncoder.lastCall!.path[0], RWA_TOKENS.test_aapl.tokenAddress);
  assert.equal(calldataEncoder.lastCall!.path[1], USDG_TOKEN.tokenAddress);

  const receipt = await executor.getReceipt(submitted.txHash);
  assert.equal(receipt.status, "SUCCESS");
  assert.equal(receipt.retryable, false);
  assert.ok(receipt.blockNumber !== undefined);
});

test("PENDING receipt: still not mined returns PENDING with retryable null (poll again later)", async () => {
  const { executor, chainReader, sessionSender } = makeExecutor();
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);
  sessionSender.setNextOutcome({ kind: "success", amount0Out: 0n, amount1Out: 1n, blockDelay: 2 });

  const submitted = await executor.executeSwap(swapParams());
  const firstPoll = await executor.getReceipt(submitted.txHash);
  assert.equal(firstPoll.status, "PENDING");
  assert.equal(firstPoll.retryable, null);

  const secondPoll = await executor.getReceipt(submitted.txHash);
  assert.equal(secondPoll.status, "PENDING");

  const thirdPoll = await executor.getReceipt(submitted.txHash);
  assert.equal(thirdPoll.status, "SUCCESS");
});

test("empty pool (GLDx/USDG): executeSwap throws a classified, non-retryable error and never calls send()", async () => {
  const { executor, sessionSender } = makeExecutor();
  let sendCalled = false;
  const originalSend = sessionSender.send.bind(sessionSender);
  sessionSender.send = async (params) => {
    sendCalled = true;
    return originalSend(params);
  };

  await assert.rejects(
    () => executor.executeSwap(swapParams({ sourceAsset: "test_gold", destinationAsset: "test_usdg" })),
    (err: unknown) => {
      if (!(err instanceof SwapExecutionError)) return false;
      assert.equal(err.reason, "NO_LIQUIDITY");
      assert.equal(err.retryable, false);
      return true;
    },
  );
  assert.equal(sendCalled, false, "an empty-pool swap must fail before ever reaching submission");
});

test("empty pool (METAx/USDG): same graceful classified failure", async () => {
  const { executor } = makeExecutor();
  await assert.rejects(
    () => executor.executeSwap(swapParams({ sourceAsset: "test_meta", destinationAsset: "test_usdg" })),
    SwapExecutionError,
  );
});

test("empty pool (NVDAx/USDG): same graceful classified failure", async () => {
  const { executor } = makeExecutor();
  await assert.rejects(
    () => executor.executeSwap(swapParams({ sourceAsset: "test_usdg", destinationAsset: "test_nvda" })),
    SwapExecutionError,
  );
});

test("0 bps slippage tolerance still submits when the fresh quote exactly meets the minimum (no over-eager rejection)", async () => {
  const { executor, chainReader, sessionSender } = makeExecutor();
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);

  let sendCalled = false;
  const originalSend = sessionSender.send.bind(sessionSender);
  sessionSender.send = async (params) => {
    sendCalled = true;
    return originalSend(params);
  };

  const result = await executor.executeSwap(swapParams({ maxSlippageBps: 0 }));
  assert.equal(result.status, "PENDING");
  assert.equal(sendCalled, true);
});

test("forced slippage breach: a pool drained between quote-time reads causes executeSwap to reject before submission", async () => {
  const { executor, chainReader, sessionSender } = makeExecutor();
  // Seed reserves generously, then drain them via a wrapped getReserves so the *first* internal
  // read (which computes amountOutMin) sees healthy reserves, but nothing else changes — this
  // isolates assertMeetsMinimumOutput's re-check by making amountOutMin computed from a
  // temporarily-inflated quote that the wrapped reader then corrects on the very next read,
  // simulating a price move between the quote and the pre-submission re-check.
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);

  let callCount = 0;
  const originalGetReserves = chainReader.getReserves.bind(chainReader);
  chainReader.getReserves = async (pairAddress: string) => {
    callCount += 1;
    const real = await originalGetReserves(pairAddress);
    if (callCount === 1) {
      // First read (used to compute amountOutMin): report far more USDG liquidity than
      // actually exists, inflating the quote the minimum gets derived from.
      return { ...real, reserve1: real.reserve1 * 100n };
    }
    // Every subsequent read (the fresh re-check before submission) sees the real, much
    // thinner reserves — producing a genuinely lower output than the inflated minimum.
    return real;
  };

  let sendCalled = false;
  sessionSender.send = async () => {
    sendCalled = true;
    return { txHash: "0xshouldnothappen" };
  };

  await assert.rejects(
    () => executor.executeSwap(swapParams({ maxSlippageBps: 100 })),
    (err: unknown) => {
      if (!(err instanceof SwapExecutionError)) return false;
      assert.equal(err.reason, "SLIPPAGE_PRECHECK_FAILED");
      assert.equal(err.retryable, true);
      return true;
    },
  );
  assert.equal(sendCalled, false, "a slippage breach detected before submission must never reach send()");
});

test("reverted transaction: FAILED receipt with classified retryable flag, not a crash", async () => {
  const { executor, chainReader, sessionSender } = makeExecutor();
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);
  sessionSender.setNextOutcome({ kind: "revert", revertReason: "UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT" });

  const submitted = await executor.executeSwap(swapParams());
  assert.equal(submitted.status, "PENDING"); // tx WAS submitted — it reverts on-chain, not pre-submission

  const receipt = await executor.getReceipt(submitted.txHash);
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.retryable, true); // slippage breach on-chain is transient/retryable
  assert.ok(receipt.errorLog?.includes("SLIPPAGE_BREACH"));
});

test("reverted transaction with an unrecognized reason defaults to non-retryable (safe halt)", async () => {
  const { executor, chainReader, sessionSender } = makeExecutor();
  seedAaplxUsdgPool(chainReader);
  chainReader.setBalance(RWA_TOKENS.test_aapl.tokenAddress, "0xWallet", 1_000_000_000_000_000_000n);
  sessionSender.setNextOutcome({ kind: "revert", revertReason: "execution reverted" });

  const submitted = await executor.executeSwap(swapParams());
  const receipt = await executor.getReceipt(submitted.txHash);
  assert.equal(receipt.status, "FAILED");
  assert.equal(receipt.retryable, false);
});

test("getReceipt for an unknown txHash returns PENDING (never crashes on a bad hash)", async () => {
  const { executor } = makeExecutor();
  const receipt = await executor.getReceipt("0xneversubmitted");
  assert.equal(receipt.status, "PENDING");
  assert.equal(receipt.retryable, null);
});
