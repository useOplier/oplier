/**
 * This package has zero runtime dependency on viem/ethers (see package.json's note) so it can
 * be unit-tested with `node:test` in a sandbox with no package registry access. Calldata
 * encoding for the Router call is therefore an injected seam, not an in-package
 * `encodeFunctionData` call.
 *
 * Real wiring in `apps/worker` (viem is already the project-wide standard per
 * `00_MASTER_BUILD_PLAN.md` §1):
 * ```ts
 * import { encodeFunctionData } from "viem";
 * import { UNISWAP_V2_ROUTER_ABI } from "@oplier/amm-execution";
 *
 * const encoder: SwapCalldataEncoder = {
 *   encodeSwapExactTokensForTokens: (p) =>
 *     encodeFunctionData({
 *       abi: UNISWAP_V2_ROUTER_ABI,
 *       functionName: "swapExactTokensForTokens",
 *       args: [p.amountIn, p.amountOutMin, p.path, p.to, p.deadline],
 *     }),
 * };
 * ```
 */
export interface SwapExactTokensForTokensCallParams {
  amountIn: bigint;
  amountOutMin: bigint;
  path: string[];
  to: string;
  /** Unix seconds. */
  deadline: bigint;
}

export interface SwapCalldataEncoder {
  encodeSwapExactTokensForTokens(params: SwapExactTokensForTokensCallParams): string;
}
