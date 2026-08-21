import { eq } from "drizzle-orm";
import { assetPrices, assetRegistry, type Database } from "@oplier/db";
import { ApiError } from "@oplier/shared-types";

/**
 * Mid-price estimate only — no slippage, fee, or liquidity modeling. That's Part F's
 * QuickSwap routing engine's job at actual execution time (doc 05 §10: the System/transaction
 * never stores QuickSwap-specific intermediate routes; the routing engine resolves the
 * executable path when it actually runs). This is a rough preview figure for the Approve/
 * Cancel Chat card, not a quote the backend commits to executing at.
 *
 * Refuses to fabricate a number when price data is missing or marked stale — throws instead
 * of guessing, per doc 03's source-hierarchy rule ("never fill missing information with
 * guesses", "state when information is unavailable").
 *
 * KNOWN MVP GAP, flagged rather than hidden: Part D (the Pyth adapter) doesn't exist yet, so
 * `asset_prices` is typically empty for the seeded testnet assets right now. That means this
 * will throw VALIDATION_ERROR for most real calls until either Part D lands or `asset_prices`
 * is manually seeded for testing — deliberate fail-closed behavior, not a bug. See
 * API_CONTRACT.md.
 *
 * Uses plain `Number` arithmetic, unlike every other money-adjacent value in this codebase
 * (which is kept as decimal strings end to end specifically to avoid float precision loss).
 * That's a deliberate, narrower exception: this figure is explicitly non-binding, never
 * written to any ledger/position/execution row, and never read back by anything that affects
 * a real balance — only displayed as a preview. If a future "confirm" endpoint ever needs to
 * commit to a number derived from this calculation, it should be redone with a decimal
 * library first.
 */
export async function estimateOutput(
  db: Database,
  args: { amount: string; amountAssetId: string; destinationAssetId: string },
): Promise<string> {
  const [amountAssetPrice, destinationAssetPrice] = await Promise.all([
    getFreshPrice(db, args.amountAssetId),
    getFreshPrice(db, args.destinationAssetId),
  ]);

  const usdValue = Number(args.amount) * Number(amountAssetPrice);
  const estimated = usdValue / Number(destinationAssetPrice);
  return estimated.toString();
}

async function getFreshPrice(db: Database, assetId: string): Promise<string> {
  const rows = await db.select().from(assetPrices).where(eq(assetPrices.assetId, assetId)).limit(1);
  const row = rows[0];
  if (!row) {
    // Stablecoins have no Pyth feed by design (registry: price_feed_id = null) — they are $1.
    // Without this, every USDG-denominated trade failed estimation despite being perfectly
    // well-formed. Anything else with no price data still fails closed below.
    const registryRows = await db
      .select()
      .from(assetRegistry)
      .where(eq(assetRegistry.assetId, assetId))
      .limit(1);
    if (registryRows[0]?.assetType === "STABLECOIN") return "1";
    throw new ApiError(
      "VALIDATION_ERROR",
      `No price data available for "${assetId}" yet — cannot estimate transaction output.`,
    );
  }
  if (row.isStale) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Price data for "${assetId}" is marked stale — cannot estimate transaction output.`,
    );
  }
  return row.price;
}