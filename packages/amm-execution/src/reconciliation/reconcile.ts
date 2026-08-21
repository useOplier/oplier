import type { ChainTransactionReceipt } from "../types.js";
import type { ResolvedRoute } from "../routing/resolve-route.js";

/**
 * doc 05 §15-16 principle (brief point 6): "For successful swaps, the backend also validates
 * the expected token output/transfer." The authoritative source is the last hop's Pair
 * `Swap` event (`amount0Out`/`amount1Out`), not our own pre-submission quote — the quote is
 * what we *expected*, the event is what actually happened on-chain.
 *
 * This package doesn't do full ABI log decoding here (no viem/ethers runtime dependency —
 * see package.json's note on why) — real wiring should decode `UNISWAP_V2_PAIR_ABI`'s `Swap`
 * event via viem's `decodeEventLog` against `logs` filtered to the last hop's pair address.
 * This function documents the exact reconciliation contract and provides a pass-through for
 * already-decoded amounts (e.g. from a test double or from a real decoder called upstream),
 * so the pipeline in execution/swap-executor.ts has a single seam to call regardless of how
 * the log gets decoded.
 */
export interface DecodedSwapOutput {
  /** Raw base-unit amount of the destination token actually transferred out, per the last hop's Swap event. */
  actualAmountOut: bigint;
}

export function reconcileOutput(
  decoded: DecodedSwapOutput,
  amountOutMin: bigint,
): { reconciled: true } | { reconciled: false; reason: string } {
  if (decoded.actualAmountOut < amountOutMin) {
    // Should be unreachable in practice — a swap that mined SUCCESS but produced less than
    // amountOutMin would have reverted on-chain (the Router enforces this itself). Kept as a
    // defensive check since "trust but verify the receipt" is the whole point of this step.
    return {
      reconciled: false,
      reason: `On-chain output (${decoded.actualAmountOut}) is below amountOutMin (${amountOutMin}) despite a SUCCESS receipt`,
    };
  }
  return { reconciled: true };
}

/** Type-only helper documenting what a real decoder needs from the route to find the right log. */
export type ReconciliationTarget = Pick<ResolvedRoute, "hops">;

export function lastHopPairAddress(route: ReconciliationTarget): string {
  return String(route.hops[route.hops.length - 1].pool.pairAddress);
}

export function receiptHasLogsFrom(receipt: ChainTransactionReceipt, address: string): boolean {
  return receipt.logs.some((log) => log.address.toLowerCase() === address.toLowerCase());
}
