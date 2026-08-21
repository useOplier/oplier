import { POOLS, type PoolConfig } from "../config/deployment.js";
import { getTokenConfig, isUsdg, type TokenConfig } from "../config/assets.js";
import { SwapExecutionError } from "../types.js";

export interface RouteHop {
  pool: PoolConfig;
  tokenIn: TokenConfig;
  tokenOut: TokenConfig;
}

export interface ResolvedRoute {
  /** assetId path, e.g. ["test_aapl", "test_usdg"] or ["test_gold", "test_usdg", "test_nvda"]. */
  assetPath: string[];
  /** Token addresses in swap order, for the Router's `path[]` param. */
  addressPath: string[];
  hops: RouteHop[];
}

/**
 * Per the brief's point 1: with USDG as the sole intermediate and 4 direct pairs, routing is
 * either direct (one side is USDG) or a single USDG hop (neither side is USDG). No general
 * multi-hop search — the brief explicitly invites flagging back if even the USDG-hop case
 * turns out unused by any real System; that determination needs the locked System examples
 * (not in this attached set), so both cases are implemented and left available rather than
 * assumed away.
 */
export function resolveRoute(sourceAsset: string, destinationAsset: string): ResolvedRoute {
  if (sourceAsset === destinationAsset) {
    throw new SwapExecutionError(
      "INVALID_ROUTE",
      false,
      `sourceAsset and destinationAsset are the same asset (${sourceAsset})`,
    );
  }

  const sourceToken = getTokenConfig(sourceAsset);
  const destToken = getTokenConfig(destinationAsset);
  if (!sourceToken) {
    throw new SwapExecutionError("UNKNOWN_ASSET", false, `No token config for assetId "${sourceAsset}"`);
  }
  if (!destToken) {
    throw new SwapExecutionError("UNKNOWN_ASSET", false, `No token config for assetId "${destinationAsset}"`);
  }

  if (isUsdg(sourceAsset) || isUsdg(destinationAsset)) {
    const rwaAssetId = isUsdg(sourceAsset) ? destinationAsset : sourceAsset;
    const pool = getPoolOrThrow(rwaAssetId);
    return {
      assetPath: [sourceAsset, destinationAsset],
      addressPath: [sourceToken.tokenAddress, destToken.tokenAddress],
      hops: [{ pool, tokenIn: sourceToken, tokenOut: destToken }],
    };
  }

  // Neither side is USDG: single hop through USDG.
  const usdgToken = getTokenConfig("test_usdg")!;
  const firstPool = getPoolOrThrow(sourceAsset);
  const secondPool = getPoolOrThrow(destinationAsset);
  return {
    assetPath: [sourceAsset, "test_usdg", destinationAsset],
    addressPath: [sourceToken.tokenAddress, usdgToken.tokenAddress, destToken.tokenAddress],
    hops: [
      { pool: firstPool, tokenIn: sourceToken, tokenOut: usdgToken },
      { pool: secondPool, tokenIn: usdgToken, tokenOut: destToken },
    ],
  };
}

function getPoolOrThrow(rwaAssetId: string): PoolConfig {
  const pool = POOLS[rwaAssetId];
  if (!pool) {
    throw new SwapExecutionError(
      "NO_ROUTE",
      false,
      `No configured pool for assetId "${rwaAssetId}" against USDG`,
    );
  }
  if (pool.status === "EMPTY") {
    // Static config says empty. This is the fast-path gate; quoting/quote.ts still does the
    // authoritative live getReserves check in case a pool was seeded since this config was
    // last regenerated from deployments/xLayerTestnet.json.
    throw new SwapExecutionError(
      "NO_LIQUIDITY",
      false,
      `Pool for "${rwaAssetId}"/USDG is created but not yet seeded (empty reserves) — ` +
        `not swappable until a follow-up seeding run`,
    );
  }
  return pool;
}
