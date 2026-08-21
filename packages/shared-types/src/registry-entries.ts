import { z } from "zod";

/** `asset_registry.asset_type` — exact enum values from Part A's real schema. */
export const assetTypeSchema = z.enum(["RWA", "STABLECOIN"]);
export type AssetType = z.infer<typeof assetTypeSchema>;

/** `asset_registry.environment` — doc 01 §12: TESTNET uses mock assets, MAINNET uses real assets. */
export const environmentSchema = z.enum(["TESTNET", "MAINNET"]);
export type Environment = z.infer<typeof environmentSchema>;

/**
 * Mirrors `packages/db/src/schema/assets.ts`'s `assetRegistry` table exactly (field-for-field,
 * same names transformed to the DB's actual camelCase column names). This is the type
 * `AssetRegistryService` (apps/api/src/registries/asset-registry.service.ts) returns — the
 * hard gate doc 01 §8 requires: "If the model outputs an unsupported asset, the execution
 * layer rejects it."
 */
export const assetRegistryEntrySchema = z.object({
  assetId: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetType: assetTypeSchema,
  underlyingAsset: z.string().nullable(),
  priceFeedId: z.string().nullable(),
  tokenAddress: z.string(),
  network: z.string(),
  environment: environmentSchema,
  decimals: z.number().int(),
  availability: z.boolean(),
  supportedActions: z.array(z.string()),
  tradingPairs: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AssetRegistryEntry = z.infer<typeof assetRegistryEntrySchema>;

/**
 * Mirrors `packages/db/src/schema/capabilities.ts`'s `capabilityRegistry` table. `conditionTypes`
 * / `swapAmountTypes` are loosely typed as `Record<string, unknown>` here rather than re-deriving
 * a strict shape — the DB row is the loosely-typed source (JSONB), and strict validation of an
 * individual condition/swap happens via `condition-params.ts` / `system-spec.ts`'s Zod schemas,
 * not by re-parsing this registry row's own JSONB shape.
 */
export const capabilityRegistryEntrySchema = z.object({
  id: z.string(),
  version: z.number().int(),
  isActive: z.boolean(),
  conditionTypes: z.record(z.string(), z.unknown()),
  swapAmountTypes: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type CapabilityRegistryEntry = z.infer<typeof capabilityRegistryEntrySchema>;
