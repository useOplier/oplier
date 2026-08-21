import type { ChainReader } from "../types.js";
import type { ResolvedRoute } from "../routing/resolve-route.js";
import { SwapExecutionError } from "../types.js";
import { V2_FEE_BPS, BPS_DENOMINATOR } from "../config/deployment.js";

/**
 * Standard UniswapV2Library.getAmountOut formula (0.3% fee baked into the 997/1000 factor),
 * reproduced here rather than called on-chain via the Router, so quoting can run against
 * `ChainReader.getReserves` (mockable, no RPC call needed) exactly as the real Router would
 * compute it on-chain. Matches the reference implementation's rounding (integer floor
 * division), which matters for exact-match tests against known reserve pairs.
 */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) {
    throw new SwapExecutionError("INVALID_AMOUNT", false, "amountIn must be greater than zero");
  }
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new SwapExecutionError("NO_LIQUIDITY", false, "Pool has zero reserves on one or both sides");
  }
  const feeMultiplier = BigInt(BPS_DENOMINATOR - V2_FEE_BPS); // 9970
  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * BigInt(BPS_DENOMINATOR) + amountInWithFee;
  return numerator / denominator;
}

interface HopReserves {
  reserveIn: bigint;
  reserveOut: bigint;
}

async function getHopReserves(
  chainReader: ChainReader,
  pairAddress: string,
  tokenInAddress: string,
): Promise<HopReserves> {
  const { reserve0, reserve1, token0 } = await chainReader.getReserves(pairAddress);
  const tokenInIsToken0 = token0.toLowerCase() === tokenInAddress.toLowerCase();
  const reserveIn = tokenInIsToken0 ? reserve0 : reserve1;
  const reserveOut = tokenInIsToken0 ? reserve1 : reserve0;
  return { reserveIn, reserveOut };
}

/**
 * Mirrors the Router's `getAmountsOut`: walks the route hop by hop, each hop's output becoming
 * the next hop's input. Returns the full amounts array (index 0 = amountIn, last = amountOut),
 * same convention as the on-chain function, so callers can log/inspect intermediate-hop output
 * (useful for the USDG-hop case).
 */
export async function quoteAmountsOut(
  chainReader: ChainReader,
  route: ResolvedRoute,
  amountIn: bigint,
): Promise<bigint[]> {
  const amounts: bigint[] = [amountIn];
  let currentAmount = amountIn;
  for (const hop of route.hops) {
    const { reserveIn, reserveOut } = await getHopReserves(
      chainReader,
      String(hop.pool.pairAddress),
      hop.tokenIn.tokenAddress,
    );
    if (reserveIn === 0n || reserveOut === 0n) {
      throw new SwapExecutionError(
        "NO_LIQUIDITY",
        false,
        `Pool ${hop.pool.pairAddress} (${hop.tokenIn.symbol}/${hop.tokenOut.symbol}) has zero reserves`,
      );
    }
    currentAmount = getAmountOut(currentAmount, reserveIn, reserveOut);
    amounts.push(currentAmount);
  }
  return amounts;
}
