import {
  type SwapExecutor,
  type SwapParams,
  type TransactionResult,
  type ChainReader,
  type SessionKeyTransactionSender,
  type RunStartBalanceStore,
} from "../types.js";
import { resolveRoute } from "../routing/resolve-route.js";
import { quoteAmountsOut } from "../quoting/quote.js";
import { computeAmountOutMin, assertMeetsMinimumOutput } from "../slippage/slippage.js";
import { resolveAmountIn } from "../amounts/resolve-amount.js";
import { classifyRevertReason } from "../classification/classify-error.js";
import { AMM_CORE } from "../config/deployment.js";
import type { SwapCalldataEncoder } from "./calldata-encoder.js";

export interface AmmSwapExecutorDeps {
  chainReader: ChainReader;
  sessionSender: SessionKeyTransactionSender;
  runStartBalanceStore: RunStartBalanceStore;
  calldataEncoder: SwapCalldataEncoder;
  /** Injected for deterministic tests; defaults to `() => Date.now()`. */
  now?: () => number;
  /**
   * Guarantees the Router holds an ERC-20 allowance for `amountIn` of the source token before the swap
   * is submitted, submitting an approval if it does not. Must be idempotent — it runs on every swap.
   *
   * WHY A CALLBACK RATHER THAN CODE HERE: `swapExactTokensForTokens` does a `transferFrom`, so without
   * an allowance every swap reverts, and nothing in this pipeline ever approved anything. Fixing it
   * needs an ERC-20 write, but this package deliberately carries no viem/registry dependency (see the
   * README and `ChainReader`'s docs) so it can unit-test with no network. The amount is only known here,
   * after `resolveAmountIn`, so the decision belongs here while the mechanics belong to the caller.
   *
   * Optional so existing tests and any caller that manages allowances out-of-band keep working
   * unchanged; when omitted, the previous behaviour (assume an allowance exists) is preserved.
   */
  ensureAllowance?: (args: {
    assetId: string;
    amountIn: bigint;
    permissionRef: string;
    /** `executions.id` — SwapParams carries no systemId; this is for log correlation only. */
    systemId: string;
  }) => Promise<void>;
}

/**
 * Real `SwapExecutor` implementation (Part C's `ENGINE_CONTRACT.md` interface) against Part
 * K's self-deployed V2-style AMM. See src/types.ts for the interface-shape reconciliation
 * flag, routing/resolve-route.ts for the routing logic, and classification/classify-error.ts
 * for the retryable/non-retryable mapping.
 *
 * Pipeline (brief's "Core responsibilities" 1-6, in order):
 *   1. resolveRoute        — direct pair or single USDG hop; throws SwapExecutionError
 *                            (non-retryable) synchronously for no-route / empty-pool cases,
 *                            per deliverable #4's "graceful, classifiable failure" requirement.
 *   2. resolveAmountIn     — FIXED / CURRENT_BALANCE_PERCENT / SYSTEM_START_BALANCE_PERCENT.
 *   3. quoteAmountsOut     — live reserves, V2 constant-product math.
 *   4. computeAmountOutMin — from maxSlippageBps; assertMeetsMinimumOutput as the final
 *                            pre-submission gate (brief point 4: never submit below minimum).
 *   5. encode + submit     — via the injected SwapCalldataEncoder + SessionKeyTransactionSender
 *                            (Part E's session-key relay — this package never signs anything).
 *   6. getReceipt          — polls the sender for a mined receipt; classifies reverts via
 *                            classification/classify-error.ts; reconciles actual output on
 *                            success.
 */
export class AmmSwapExecutor implements SwapExecutor {
  // `ensureAllowance` stays optional through the Required<> defaulting — omitting it is a supported
  // configuration (callers managing allowances out-of-band), not a missing default.
  private readonly deps: Required<Omit<AmmSwapExecutorDeps, "ensureAllowance">> &
    Pick<AmmSwapExecutorDeps, "ensureAllowance">;
  /**
   * txHash -> last-hop pair address, kept only so getReceipt can find the right Swap log to
   * reconcile against. Not persisted — Part I should back this with the `executions` row
   * (`tx_hash` is already a column there per full_schema.txt) instead of an in-memory map, so
   * a worker restart mid-poll doesn't lose the mapping.
   */
  private readonly routeByTxHash = new Map<string, { lastHopPairAddress: string; amountOutMin: bigint }>();

  constructor(deps: AmmSwapExecutorDeps) {
    this.deps = { now: () => Date.now(), ...deps };
  }

  async executeSwap(params: SwapParams): Promise<{ txHash: string; status: "PENDING" | "SUBMITTED" }> {
    // Step 1: routing. Throws SwapExecutionError synchronously for no-route/empty-pool —
    // no txHash exists yet, so this is the pre-submission failure path (see types.ts's flag).
    const route = resolveRoute(params.sourceAsset, params.destinationAsset);

    // Step 2: amount resolution.
    const amountIn = await resolveAmountIn(params, {
      chainReader: this.deps.chainReader,
      runStartBalanceStore: this.deps.runStartBalanceStore,
    });

    // Step 3: allowance. Before quoting/submitting, make sure the Router can actually pull `amountIn`
    // — `swapExactTokensForTokens` does a `transferFrom`, so a missing allowance reverts the swap. Runs
    // before the fresh quote so an approval's latency can't stale the slippage check below.
    await this.deps.ensureAllowance?.({
      assetId: params.sourceAsset,
      amountIn,
      permissionRef: params.permissionRef,
      systemId: params.executionId,
    });

    // Step 4: initial quote — this is what amountOutMin is derived from.
    const amounts = await quoteAmountsOut(this.deps.chainReader, route, amountIn);
    const quotedAmountOut = amounts[amounts.length - 1];
    const amountOutMin = computeAmountOutMin(quotedAmountOut, params.maxSlippageBps);

    // Step 5: slippage protection — re-quote immediately before submission and compare that
    // independent, fresh read against amountOutMin (brief point 4: "compute expected output
    // ... Do not submit if the pool's current state would produce output below minimum").
    // Comparing amountOutMin against the *same* quote it was derived from would be vacuous
    // (amountOutMin is always <= quotedAmountOut by construction) — this second read is what
    // actually catches a price move between quote-time and submission-time. Never auto-widens
    // the limit if this fails (verbatim brief requirement).
    const freshAmounts = await quoteAmountsOut(this.deps.chainReader, route, amountIn);
    const freshQuotedAmountOut = freshAmounts[freshAmounts.length - 1];
    assertMeetsMinimumOutput(freshQuotedAmountOut, amountOutMin);

    // Step 6: construct + submit.
    const deadlineSeconds = BigInt(Math.floor(params.deadline.getTime() / 1000));
    const calldata = this.deps.calldataEncoder.encodeSwapExactTokensForTokens({
      amountIn,
      amountOutMin,
      path: route.addressPath,
      to: params.walletAddress,
      deadline: deadlineSeconds,
    });

    const { txHash } = await this.deps.sessionSender.send({
      to: AMM_CORE.router,
      data: calldata,
      permissionRef: params.permissionRef,
    });

    this.routeByTxHash.set(txHash, {
      lastHopPairAddress: String(route.hops[route.hops.length - 1].pool.pairAddress),
      amountOutMin,
    });

    return { txHash, status: "PENDING" };
  }

  async getReceipt(txHash: string): Promise<TransactionResult> {
    const receipt = await this.deps.sessionSender.getTransactionReceipt(txHash);

    if (!receipt) {
      return { txHash, status: "PENDING", retryable: null };
    }

    if (receipt.status === "reverted") {
      const { retryable, reason } = classifyRevertReason(receipt.revertReason);
      return {
        txHash,
        status: "FAILED",
        retryable,
        errorLog: `${reason}: ${receipt.revertReason ?? "no revert reason returned"}`,
        blockNumber: receipt.blockNumber,
      };
    }

    // status === "success"
    return {
      txHash,
      status: "SUCCESS",
      retryable: false,
      blockNumber: receipt.blockNumber,
      // Real wiring decodes the last hop's Swap event (reconciliation/reconcile.ts) via
      // UNISWAP_V2_PAIR_ABI to populate this with the exact actual amountOut. Left undefined
      // here since this package ships no log decoder (see calldata-encoder.ts's note on the
      // zero-viem-runtime-dependency design) — `test/swap-executor.test.ts` exercises the
      // reconciliation math directly against `reconciliation/reconcile.ts` instead.
      amountOut: undefined,
    };
  }
}
