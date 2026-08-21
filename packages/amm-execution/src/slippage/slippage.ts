import { BPS_DENOMINATOR } from "../config/deployment.js";
import { SwapExecutionError } from "../types.js";

/**
 * doc 05 §13's principle, V2 mechanics per the brief's point 4: derive `amountOutMin` from the
 * configured max slippage against a fresh quote. "Fresh" is enforced by the caller (execution/
 * swap-executor.ts always re-quotes immediately before computing this, never reuses a stale
 * quote) — this function itself is pure arithmetic.
 */
export function computeAmountOutMin(quotedAmountOut: bigint, maxSlippageBps: number): bigint {
  if (maxSlippageBps < 0 || maxSlippageBps > BPS_DENOMINATOR) {
    throw new SwapExecutionError(
      "INVALID_SLIPPAGE",
      false,
      `maxSlippageBps must be between 0 and ${BPS_DENOMINATOR}, got ${maxSlippageBps}`,
    );
  }
  const retainedBps = BigInt(BPS_DENOMINATOR - maxSlippageBps);
  return (quotedAmountOut * retainedBps) / BigInt(BPS_DENOMINATOR);
}

/**
 * "Never auto-widen slippage" (brief point 4, verbatim). This is a defensive re-check callable
 * right before submission: if the freshest quote's output would already be below the minimum
 * the System configured, do not submit — same "do not submit" language as doc 05 §13.
 */
export function assertMeetsMinimumOutput(freshQuotedAmountOut: bigint, amountOutMin: bigint): void {
  if (freshQuotedAmountOut < amountOutMin) {
    throw new SwapExecutionError(
      "SLIPPAGE_PRECHECK_FAILED",
      true,
      `Fresh quote (${freshQuotedAmountOut}) is below the configured minimum output ` +
        `(${amountOutMin}) — not submitting. Pool conditions may recover; safe to retry.`,
    );
  }
}
