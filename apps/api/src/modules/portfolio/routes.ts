import type { FastifyInstance } from "fastify";
import { createPublicClient, erc20Abi, http, formatUnits } from "viem";
import { assetRegistry, assetPrices } from "@oplier/db";
import { portfolioResponseSchema } from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";
import { loadEnv } from "../../config/env.js";

/**
 * GET /portfolio — doc 01 §14 Home / Portfolio screen: holdings + total value.
 *
 * WHAT CHANGED AND WHY. This used to read the `positions` table, which meant it reported what our own
 * execution history believed rather than what the wallet actually holds. The gap was not academic: a
 * wallet holding 10 tUSDG and 0.0118 AAPLx showed a $0 portfolio, because (a) balances were never read
 * from chain, (b) only `status = 'OPEN'` rows counted and the sole row had been closed on run
 * completion, and (c) that row belonged to the System's configured wallet rather than the signed-in
 * one. Any single one of those was enough to produce $0.
 *
 * Balances now come from ERC-20 `balanceOf` on X Layer, so the number matches what a block explorer
 * shows. Prices still come from `asset_prices` (Pyth-fed) — chain for quantity, our own oracle data for
 * value.
 *
 * SCOPE, deliberately narrow: only assets present in `asset_registry` are read — RWA tokens and
 * registered stablecoins. This is NOT a wallet scanner. Whatever else the wallet happens to hold is
 * ignored, so an airdropped or unrecognised token can never appear in a portfolio total.
 *
 * PRODUCT DECISION (2026-08-21, overrides doc 06 §2): doc 06 §2 restricted Home's holdings to "RWA
 * assets only", and this route previously excluded STABLECOIN on that basis. The product owner has
 * since specified that the portfolio covers RWA *and* registered stablecoins, since a portfolio
 * reporting $0 while the wallet holds 10 tUSDG is simply wrong to a user. Stablecoins are therefore
 * included in `holdings` and in `totalValue`; `cashBalance` is a convenience SUBTOTAL of that same
 * stablecoin value, already counted in `totalValue` — it is not additive.
 */

/** Assets with a zero on-chain balance are omitted rather than listed as empty rows. */
const DUST_THRESHOLD = 0n;

export default async function portfolioRoutes(fastify: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const chainClient = createPublicClient({
    transport: http(env.XLAYER_RPC_URL, {
      // The X Layer testnet endpoint answers a simple call in ~2.7s when healthy, so viem's 10s
      // default leaves little headroom under concurrent load.
      timeout: 30_000,
    }),
  });

  fastify.get("/portfolio", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress as `0x${string}`;

    const [assets, prices] = await Promise.all([
      fastify.db.select().from(assetRegistry),
      fastify.db.select({ assetId: assetPrices.assetId, price: assetPrices.price }).from(assetPrices),
    ]);

    const priceByAssetId = new Map(prices.map((p) => [p.assetId, Number(p.price)]));

    /**
     * One `balanceOf` per registered asset, in parallel. A single failing token must not blank the
     * whole portfolio — an unreachable RPC or a bad token address yields `null` for that asset and it
     * is skipped, which is strictly better than returning a total that silently omits assets it claims
     * to have counted.
     */
    const balances = await Promise.all(
      assets.map(async (asset) => {
        try {
          const raw = await chainClient.readContract({
            address: asset.tokenAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [walletAddress],
          });
          return { asset, raw: raw as bigint };
        } catch (err) {
          fastify.log.warn(
            { err, assetId: asset.assetId, tokenAddress: asset.tokenAddress },
            "portfolio: balanceOf failed; asset omitted from totals",
          );
          return { asset, raw: null };
        }
      }),
    );

    let totalValue = 0;
    let cashBalance = 0;
    const holdings: unknown[] = [];

    for (const { asset, raw } of balances) {
      if (raw === null || raw <= DUST_THRESHOLD) continue;

      // RWA and registered stablecoins only. Anything else in the registry is not a holding this
      // screen represents, and unregistered tokens were never fetched in the first place.
      if (asset.assetType !== "RWA" && asset.assetType !== "STABLECOIN") continue;

      const quantity = Number(formatUnits(raw, asset.decimals));

      /**
       * Stablecoins are valued at 1.0 rather than looked up: there is deliberately no Pyth feed for
       * tUSDG (see feed-registry.ts), and the peg-check path lives in the price adapter, not here. An
       * RWA with no price contributes 0 to the total — the quantity is real and still shown, but
       * inventing a value for it would be worse than omitting it.
       */
      const isStable = asset.assetType === "STABLECOIN";
      const price = isStable ? 1 : priceByAssetId.get(asset.assetId);
      const currentValue = price === undefined ? 0 : quantity * price;

      totalValue += currentValue;
      if (isStable) cashBalance += currentValue;

      holdings.push({
        asset: {
          assetId: asset.assetId,
          symbol: asset.symbol,
          name: asset.name,
          assetType: asset.assetType,
          underlyingAsset: asset.underlyingAsset,
          priceFeedId: asset.priceFeedId,
          tokenAddress: asset.tokenAddress,
          network: asset.network,
          environment: asset.environment,
          decimals: asset.decimals,
          availability: asset.availability,
          supportedActions: asset.supportedActions as string[],
          tradingPairs: asset.tradingPairs as string[],
          createdAt: asset.createdAt.toISOString(),
          updatedAt: asset.updatedAt.toISOString(),
        },
        quantity: String(quantity),
        // Cost basis is an execution-history concept and is not knowable from a chain balance —
        // tokens may have arrived from anywhere. GET /positions remains the source for it.
        costBasis: "0",
        currentValue: String(currentValue),
      });
    }

    reply.send(
      portfolioResponseSchema.parse({
        holdings,
        totalValue: String(totalValue),
        cashBalance: String(cashBalance),
      }),
    );
  });
}
