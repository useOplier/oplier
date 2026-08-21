import { config } from "dotenv";
config();
import { createDb } from "./index";
import { assetRegistry, capabilityRegistry } from "./schema";

/**
 * Seeds:
 *  1. capability_registry v1 (active) — the MVP condition/amount-type definitions from
 *     doc 04 §2 and §6, machine-readable so LLM #1 and the backend validator can check
 *     requests against it.
 *  2. asset_registry starter rows — AAPLx, METAx, NVDAx, GLDx, USDG (doc 05 §1).
 *
 * SYMBOL CORRECTION (post-launch, verified directly against the live Supabase DB, not
 * guessed): the original placeholder symbols (tAAPL/tMETA/tNVDA/tGOLD/tUSDG) were manually
 * corrected in the live DB to match the actual xStocks-style naming convention doc 07 §13
 * references (AAPLx/METAx/NVDAx/GLDx) and the real settlement stablecoin symbol (USDG, no
 * `t` prefix). `underlyingAsset` for the gold asset corrected from "GOLD" to the real ticker
 * "GLD". `assetId` slugs (test_aapl/test_meta/test_nvda/test_gold/test_usdg) are UNCHANGED —
 * only the display symbol/underlying-ticker/token-address fields were corrected, since
 * assetId is the FK target referenced by systems/swaps/positions/transactions and changing
 * it would be a much larger, unrequested operation.
 *
 * `tokenAddress` for the four RWA rows remains a PLACEHOLDER ("0x0000...") — still pending
 * Part D/E. The USDG row's `tokenAddress` is NOT a placeholder: it's the real testnet
 * contract, user-verified directly (holds an actual balance at that address), so don't
 * "correct" it back to a placeholder or re-derive/checksum it — it's authoritative as given.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  const db = createDb(connectionString);

  console.log("Seeding capability_registry v1...");
  await db
    .insert(capabilityRegistry)
    .values({
      version: 1,
      isActive: true,
      conditionTypes: {
        PRICE_VALUE: {
          description: "if price = X / if price > X / if price < X",
          params: { asset: "asset_id", operator: "EQ | GT | LT", value: "decimal" },
        },
        PRICE_PERCENT: {
          description: "if price = +X% / if price = -X%",
          params: { asset: "asset_id", direction: "UP | DOWN", percent: "decimal (0-100]" },
        },
        ROI: {
          description: "if asset ROI = +X% / -X%, based on the user's actual position",
          params: { asset: "asset_id", direction: "UP | DOWN", percent: "decimal (0-100]" },
        },
        TIME: {
          description: "if date = DD/MM/YYYY / if time = HH:MM (universal app timezone)",
          params: { date: "YYYY-MM-DD | null", time: "HH:MM | null" },
        },
        HIGH_IMPACT_NEWS: {
          description: "if HIN < 24 hours / if HIN < 1 hour, against the predefined HIN list",
          params: { withinHours: "1 | 24" },
        },
      },
      swapAmountTypes: {
        FIXED: {
          description: "Absolute amount of the source asset.",
          params: { amount: "decimal" },
        },
        CURRENT_BALANCE_PERCENT: {
          description: "Percentage of the source asset's balance at execution time.",
          params: { sourceAsset: "asset_id", percent: "decimal (0-100]" },
        },
        SYSTEM_START_BALANCE_PERCENT: {
          description: "Percentage of the source asset's balance at System execution start.",
          params: { sourceAsset: "asset_id", percent: "decimal (0-100]" },
        },
      },
    })
    .onConflictDoNothing();

  console.log("Seeding testnet asset_registry starter rows...");
  const testnetAssets = [
    // `priceFeedId` values are the REAL Pyth feed ids, copied from
    // packages/data-layer/src/pyth/feed-registry.ts where each is marked `verified: true` against
    // Pyth's live registry. They were previously the literal string "PLACEHOLDER_PYTH_FEED_ID",
    // which doc 05 §2 makes wrong: asset_registry.price_feed_id is the designated source of truth
    // for the asset -> feed mapping. Prices worked anyway only because the worker resolves feeds from
    // feed-registry.ts rather than from this column, so the placeholder was invisible at runtime while
    // still being incorrect in the table a reviewer would read first.
    { assetId: "test_aapl", symbol: "AAPLx", name: "Apple (testnet)", underlyingAsset: "AAPL",
      priceFeedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" },
    { assetId: "test_meta", symbol: "METAx", name: "Meta Platforms (testnet)", underlyingAsset: "META",
      priceFeedId: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe" },
    { assetId: "test_nvda", symbol: "NVDAx", name: "NVIDIA (testnet)", underlyingAsset: "NVDA",
      priceFeedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593" },
    // GLD equity feed, NOT spot gold (Metal.XAU/USD) — see feed-registry.ts's test_gold note; the
    // two differ by ~10.9x.
    { assetId: "test_gold", symbol: "GLDx", name: "Gold (testnet)", underlyingAsset: "GLD",
      priceFeedId: "e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca" },
  ] as const;

  for (const asset of testnetAssets) {
    await db
      .insert(assetRegistry)
      .values({
        assetId: asset.assetId,
        symbol: asset.symbol,
        name: asset.name,
        assetType: "RWA",
        underlyingAsset: asset.underlyingAsset,
        priceFeedId: asset.priceFeedId,
        tokenAddress: "0x0000000000000000000000000000000000000000",
        network: "x-layer-testnet",
        environment: "TESTNET",
        decimals: 18,
        availability: true,
        supportedActions: ["BUY", "SELL"],
        tradingPairs: ["test_usdg"],
      })
      .onConflictDoNothing();
  }

  await db
    .insert(assetRegistry)
    .values({
      assetId: "test_usdg",
      symbol: "USDG",
      name: "USDG (testnet)",
      assetType: "STABLECOIN",
      underlyingAsset: null,
      // NULL, not a placeholder string: USDG deliberately has no Pyth feed (feed-registry.ts omits it)
      // and is valued via the peg-check path instead. A fake id here would imply a mapping exists.
      priceFeedId: null,
      tokenAddress: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1",
      network: "x-layer-testnet",
      environment: "TESTNET",
      decimals: 6,
      availability: true,
      supportedActions: ["BUY", "SELL"],
      tradingPairs: ["test_aapl", "test_meta", "test_nvda", "test_gold"],
    })
    .onConflictDoNothing();

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});