import { decodeEventLog, encodeFunctionData } from "viem";
import {
  UNISWAP_V2_PAIR_ABI,
  UNISWAP_V2_ROUTER_ABI,
  getTokenConfig,
  type SwapCalldataEncoder,
  type SwapExactTokensForTokensCallParams,
} from "@oplier/amm-execution";

/**
 * The two viem seams `@oplier/amm-execution` declares and expects `apps/worker` to fill:
 * Router calldata encoding, and `Swap` event decoding for post-success reconciliation. That
 * package ships neither because it has no viem runtime dependency (its README: "Real wiring in
 * `apps/worker` needs `encodeFunctionData` / `decodeEventLog` from viem plugged into those two
 * seams — that's the one concrete live-verification task before this ships").
 *
 * NOT YET RUN AGAINST A LIVE CHAIN.
 */

/** Router calldata encoder — matches the snippet in amm-execution's `calldata-encoder.ts` doc. */
export const viemCalldataEncoder: SwapCalldataEncoder = {
  encodeSwapExactTokensForTokens(params: SwapExactTokensForTokensCallParams): string {
    return encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [
        params.amountIn,
        params.amountOutMin,
        params.path as readonly `0x${string}`[],
        params.to as `0x${string}`,
        params.deadline,
      ],
    });
  },
};

export interface DecodedSwapAmounts {
  /** Raw base units of the destination token actually received. */
  actualAmountOut: bigint;
  /** Raw base units of the source token actually spent. */
  actualAmountIn: bigint;
}

/**
 * Recovers the real fill amounts from a receipt's logs — the authoritative reconciliation source
 * per doc 05 §16 ("Internal state must reflect actual on-chain execution rather than merely the
 * original quote").
 *
 * Mechanics that matter, and why:
 *  - V2's `Swap` event reports `amount0In/amount1In/amount0Out/amount1Out` against the PAIR's
 *    token0/token1 ordering, which is by address, not by swap direction. So the caller must supply
 *    `token0` for the relevant pair; picking the non-zero field blindly would silently invert
 *    amountIn and amountOut on roughly half of all pairs.
 *  - For a multi-hop route the last hop's pair carries the output the user actually receives, and
 *    the FIRST hop's pair carries what they actually spent. Passing both addresses keeps a USDG-hop
 *    swap correct rather than reporting the intermediate leg.
 *  - Logs from other contracts in the same transaction (ERC-20 `Transfer`s, etc.) are skipped by
 *    address filter and by `decodeEventLog` failing, which is caught per-log rather than aborting.
 */
export function decodeSwapAmountsFromLogs(params: {
  logs: Array<{ address: string; topics: string[]; data: string }>;
  firstHopPairAddress: string;
  lastHopPairAddress: string;
  /** token0 of the first hop's pair, to orient that pair's In/Out fields. */
  firstHopToken0: string;
  /** token0 of the last hop's pair. */
  lastHopToken0: string;
  /** Source asset's token address, so we know which side of the first pair we paid in. */
  sourceTokenAddress: string;
  /** Destination asset's token address, so we know which side of the last pair we received. */
  destinationTokenAddress: string;
}): DecodedSwapAmounts | null {
  const swapsByPair = new Map<string, { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint }>();

  for (const log of params.logs) {
    const address = log.address.toLowerCase();
    if (address !== params.firstHopPairAddress.toLowerCase() && address !== params.lastHopPairAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: UNISWAP_V2_PAIR_ABI,
        eventName: "Swap",
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`,
      });
      const args = decoded.args as unknown as {
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
      };
      // Last write wins per pair. A single pair appearing twice in one transaction would mean a
      // route that revisits it, which this AMM's routing never produces (direct or single USDG hop).
      swapsByPair.set(address, args);
    } catch {
      // Not a Swap event (or a shape we don't recognise) — skip it, don't abort reconciliation.
      continue;
    }
  }

  const firstSwap = swapsByPair.get(params.firstHopPairAddress.toLowerCase());
  const lastSwap = swapsByPair.get(params.lastHopPairAddress.toLowerCase());
  if (!firstSwap || !lastSwap) return null;

  // Which numbered slot is our source token in the first pair, and our destination token in the last?
  const sourceIsToken0 = params.firstHopToken0.toLowerCase() === params.sourceTokenAddress.toLowerCase();
  const destIsToken0 = params.lastHopToken0.toLowerCase() === params.destinationTokenAddress.toLowerCase();

  return {
    actualAmountIn: sourceIsToken0 ? firstSwap.amount0In : firstSwap.amount1In,
    actualAmountOut: destIsToken0 ? lastSwap.amount0Out : lastSwap.amount1Out,
  };
}

/**
 * Formats raw base units back into the human-decimal string the DB stores.
 *
 * `positions`/`transactions` are `numeric(38,18)` decimal columns, so amounts must be written in
 * human units — writing raw base units would overstate a value by 10^decimals. Uses BigInt string
 * surgery rather than dividing through a float, since a float divide on an 18-decimal value loses
 * precision exactly where money is involved.
 */
export function formatBaseUnits(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const negative = raw < 0n;
  const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const formatted = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${formatted}` : formatted;
}

/** Convenience: format an amount for a known assetId, using its registered decimals. */
export function formatAssetAmount(assetId: string, raw: bigint): string | null {
  const token = getTokenConfig(assetId);
  if (!token) return null;
  return formatBaseUnits(raw, token.decimals);
}
