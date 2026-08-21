import {
  getTokenConfig,
  resolveRoute,
  type ChainReader,
  type SessionKeyTransactionSender,
  type SwapExecutor,
  type SwapParams,
  type TransactionResult,
} from "@oplier/amm-execution";
import { decodeSwapAmountsFromLogs, formatBaseUnits } from "../chain/viem-seams.js";
import type { Logger } from "../lib/logger.js";

/**
 * Wraps `AmmSwapExecutor` to populate the reconciled `amountIn`/`amountOut` the engine now requires
 * (doc 05 §16: "Internal state must reflect actual on-chain execution rather than merely the
 * original quote").
 *
 * ── Why a wrapper rather than a change inside `@oplier/amm-execution` ──
 *
 * That package has a deliberate zero-runtime-dependency-on-viem design so it can unit-test with no
 * registry access, which is why its `getReceipt` returns `amountOut: undefined` and its
 * `reconciliation/reconcile.ts` is a pass-through for "already-decoded amounts (e.g. ... from a real
 * decoder called upstream)". Log decoding needs viem's `decodeEventLog`. Putting the decoder here
 * honours that design instead of forcing viem into a package that intentionally avoids it — and
 * "upstream" is precisely this worker.
 *
 * ── The double receipt fetch, and why it is deliberate ──
 *
 * `AmmSwapExecutor.getReceipt` returns a `TransactionResult`, which carries no logs, and its
 * internal txHash->route map is private. So this class:
 *   1. delegates to the inner executor for status + retryability classification (never re-deriving
 *      either — the engine treats `retryable` as authoritative and so does this), then
 *   2. on SUCCESS only, fetches the raw receipt once more to read its logs and decode the real
 *      amounts.
 * Step 2 costs one extra RPC read per successful swap — bounded, on the rarest path, and only when
 * there is something to reconcile. Re-implementing classification here to avoid it would duplicate
 * the exact logic doc 05 §24 says must live in one place.
 *
 * ⚠ NOT YET RUN AGAINST A LIVE CHAIN.
 */

interface RouteMemo {
  sourceAsset: string;
  destinationAsset: string;
  firstHopPairAddress: string;
  lastHopPairAddress: string;
}

export interface ReconcilingSwapExecutorDeps {
  inner: SwapExecutor;
  chainReader: ChainReader;
  /** Needed for the raw receipt (logs); the inner executor's `TransactionResult` has none. */
  sessionSender: SessionKeyTransactionSender;
  logger: Logger;
}

export class ReconcilingSwapExecutor implements SwapExecutor {
  private readonly logger: Logger;
  /**
   * txHash -> route, so `getReceipt` knows which pairs to decode.
   *
   * In-memory, and therefore lost on restart — the same durability caveat `AmmSwapExecutor` documents
   * for its own private map ("Part I should back this with the `executions` row ... so a worker
   * restart mid-poll doesn't lose the mapping"). The consequence here is bounded and non-corrupting:
   * a swap that succeeds across a restart is recorded with null amounts and an explicit
   * `reconciliation_route_unknown` warning rather than a wrong cost basis, because the engine skips
   * the position update when amounts are absent. Recovering it fully means re-deriving the route from
   * the persisted execution's step (source/destination assets are in `swaps`), which is a follow-up
   * worth doing before mainnet; see DEPLOYMENT_RUNBOOK.md's incident section.
   */
  private readonly routeByTxHash = new Map<string, RouteMemo>();

  constructor(private readonly deps: ReconcilingSwapExecutorDeps) {
    this.logger = deps.logger.child({ component: "reconciling-executor" });
  }

  async executeSwap(params: SwapParams): Promise<{ txHash: string; status: "PENDING" | "SUBMITTED" }> {
    const submitted = await this.deps.inner.executeSwap(params);
    // Route resolution is pure and deterministic for a given asset pair, so recomputing it here
    // matches exactly what the inner executor used.
    try {
      const route = resolveRoute(params.sourceAsset, params.destinationAsset);
      const hops = route.hops;
      this.routeByTxHash.set(submitted.txHash, {
        sourceAsset: params.sourceAsset,
        destinationAsset: params.destinationAsset,
        firstHopPairAddress: String(hops[0]!.pool.pairAddress),
        lastHopPairAddress: String(hops[hops.length - 1]!.pool.pairAddress),
      });
    } catch (err) {
      // Should be unreachable: the inner executor already resolved the same route successfully, or
      // it would have thrown before submitting. Logged rather than thrown so a reconciliation
      // bookkeeping problem can never fail an otherwise-successful submission.
      this.logger.warn("route_memo_failed", { txHash: submitted.txHash, err });
    }
    return submitted;
  }

  async getReceipt(txHash: string): Promise<TransactionResult> {
    const result = await this.deps.inner.getReceipt(txHash);
    if (result.status !== "SUCCESS") return result;

    const memo = this.routeByTxHash.get(txHash);
    if (!memo) {
      this.logger.warn("reconciliation_route_unknown", {
        txHash,
        detail:
          "No route memo for this txHash (most likely a worker restart between submission and " +
          "receipt). Recording the swap without reconciled amounts — the engine will skip the " +
          "position update rather than write a fabricated cost basis.",
      });
      return result;
    }

    try {
      const raw = await this.deps.sessionSender.getTransactionReceipt(txHash);
      if (!raw || raw.status !== "success") return result;

      const sourceToken = getTokenConfig(memo.sourceAsset);
      const destToken = getTokenConfig(memo.destinationAsset);
      if (!sourceToken || !destToken) return result;

      // Pair token ordering is by address, not swap direction, so token0 of each relevant pair is
      // required to orient the Swap event's In/Out fields correctly.
      const [firstPair, lastPair] = await Promise.all([
        this.deps.chainReader.getReserves(memo.firstHopPairAddress),
        memo.firstHopPairAddress === memo.lastHopPairAddress
          ? this.deps.chainReader.getReserves(memo.firstHopPairAddress)
          : this.deps.chainReader.getReserves(memo.lastHopPairAddress),
      ]);

      const decoded = decodeSwapAmountsFromLogs({
        logs: raw.logs,
        firstHopPairAddress: memo.firstHopPairAddress,
        lastHopPairAddress: memo.lastHopPairAddress,
        firstHopToken0: firstPair.token0,
        lastHopToken0: lastPair.token0,
        sourceTokenAddress: sourceToken.tokenAddress,
        destinationTokenAddress: destToken.tokenAddress,
      });

      if (!decoded) {
        this.logger.warn("reconciliation_decode_failed", {
          txHash,
          detail: "No Swap event found for the expected pair(s) — recording without amounts.",
        });
        return result;
      }

      const amountIn = formatBaseUnits(decoded.actualAmountIn, sourceToken.decimals);
      const amountOut = formatBaseUnits(decoded.actualAmountOut, destToken.decimals);

      this.logger.info("swap_reconciled", {
        txHash,
        sourceAsset: memo.sourceAsset,
        destinationAsset: memo.destinationAsset,
        amountIn,
        amountOut,
        blockNumber: raw.blockNumber,
      });

      this.routeByTxHash.delete(txHash);

      return { ...result, amountIn, amountOut, blockNumber: raw.blockNumber };
    } catch (err) {
      // Reconciliation is bookkeeping; a failure here must not turn a successful swap into a failed
      // one. The swap did happen on-chain, and the engine records it with null amounts.
      this.logger.error("reconciliation_failed", { txHash, err });
      return result;
    }
  }
}
