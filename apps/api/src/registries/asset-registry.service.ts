import { eq, and, sql } from "drizzle-orm";
import { assetRegistry, type Database } from "@oplier/db";
import { ApiError, type AssetRegistryEntry, type Environment } from "@oplier/shared-types";

/**
 * Read-only service over `asset_registry` (Part B brief §2). "This is a hard gate, not a
 * suggestion" — doc 01 §8: "If the model outputs an unsupported asset, the execution layer
 * rejects it." Every write path that touches an asset id (system creation, one-off
 * transactions) must call `validateAsset` before doing anything else with that id.
 */
export class AssetRegistryService {
  constructor(
    private readonly db: Database,
    private readonly environment: Environment,
  ) {}

  private toEntry(row: typeof assetRegistry.$inferSelect): AssetRegistryEntry {
    return {
      assetId: row.assetId,
      symbol: row.symbol,
      name: row.name,
      assetType: row.assetType,
      underlyingAsset: row.underlyingAsset,
      priceFeedId: row.priceFeedId,
      tokenAddress: row.tokenAddress,
      network: row.network,
      environment: row.environment,
      decimals: row.decimals,
      availability: row.availability,
      supportedActions: row.supportedActions as string[],
      tradingPairs: row.tradingPairs as string[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** All assets available in the current environment (doc 01 §12). */
  async listAvailable(): Promise<AssetRegistryEntry[]> {
    const rows = await this.db
      .select()
      .from(assetRegistry)
      .where(and(eq(assetRegistry.environment, this.environment), eq(assetRegistry.availability, true)));
    return rows.map((r) => this.toEntry(r));
  }

  async getByAssetId(assetId: string): Promise<AssetRegistryEntry | null> {
    const rows = await this.db.select().from(assetRegistry).where(eq(assetRegistry.assetId, assetId)).limit(1);
    return rows[0] ? this.toEntry(rows[0]) : null;
  }

  /**
   * Resolves an identifier that may be EITHER an asset_id ("test_usdg") OR a ticker symbol
   * ("USDG") into a registry entry. Callers upstream of the registry speak different dialects:
   * the LLM tools and API schemas use symbols (the LLM tool schema literally says "Asset
   * symbol"), while `trading_pairs` stores asset_ids — rejecting symbols here made every
   * LLM-driven trade/system validation fail with UNSUPPORTED_ASSET despite the asset existing
   * (seen live 2026-08-21). Case-insensitive on purpose: models emit "aaplx" as often as not.
   */
  async resolveAsset(symbolOrAssetId: string): Promise<AssetRegistryEntry | null> {
    const byId = await this.getByAssetId(symbolOrAssetId);
    if (byId) return byId;
    const rows = await this.db
      .select()
      .from(assetRegistry)
      .where(
        and(
          eq(assetRegistry.environment, this.environment),
          sql`lower(${assetRegistry.symbol}) = lower(${symbolOrAssetId})`,
        ),
      )
      .limit(1);
    return rows[0] ? this.toEntry(rows[0]) : null;
  }

  /**
   * THE hard gate. Validates that `assetId` exists, is available in the current environment,
   * and (if `requiredAction` is given) supports that action (e.g. "BUY"/"SELL" — doc 01 §8
   * "Supported actions"). Throws `ApiError("UNSUPPORTED_ASSET", ...)` on any failure — callers
   * must let this throw propagate rather than catching and substituting a default, per doc 02:
   * "Unsupported requests are not silently changed, approximated, or worked around."
   */
  async validateAsset(assetIdOrSymbol: string, requiredAction?: string): Promise<AssetRegistryEntry> {
    const entry = await this.resolveAsset(assetIdOrSymbol);
    if (!entry) {
      throw new ApiError("UNSUPPORTED_ASSET", `Asset "${assetIdOrSymbol}" is not in the asset registry.`);
    }
    if (entry.environment !== this.environment) {
      throw new ApiError(
        "UNSUPPORTED_ASSET",
        `Asset "${assetIdOrSymbol}" belongs to the ${entry.environment} environment, not ${this.environment}.`,
      );
    }
    if (!entry.availability) {
      throw new ApiError("UNSUPPORTED_ASSET", `Asset "${assetIdOrSymbol}" is currently unavailable.`);
    }
    if (requiredAction && !entry.supportedActions.includes(requiredAction)) {
      throw new ApiError(
        "UNSUPPORTED_ASSET",
        `Asset "${assetIdOrSymbol}" does not support the "${requiredAction}" action.`,
      );
    }
    return entry;
  }

  /**
   * Validates that two assets can be swapped against each other (doc 04 §5, `swaps.tradingPairs`).
   * Accepts asset_id OR symbol for both sides (see resolveAsset). Returns the resolved entries so
   * callers can use canonical asset_ids downstream (prices, execution) instead of re-guessing.
   */
  async validateTradingPair(
    sourceAssetIdOrSymbol: string,
    destinationAssetIdOrSymbol: string,
  ): Promise<{ source: AssetRegistryEntry; destination: AssetRegistryEntry }> {
    const source = await this.validateAsset(sourceAssetIdOrSymbol, "SELL");
    const destination = await this.validateAsset(destinationAssetIdOrSymbol, "BUY");
    // trading_pairs stores ASSET_IDS, so compare against the resolved destination id — comparing
    // raw user input ("AAPLx") against ids ("test_aapl") always failed.
    if (!source.tradingPairs.includes(destination.assetId)) {
      throw new ApiError(
        "UNSUPPORTED_ASSET",
        `"${sourceAssetIdOrSymbol}" cannot be swapped directly for "${destinationAssetIdOrSymbol}" — not a supported trading pair.`,
      );
    }
    return { source, destination };
  }
}
