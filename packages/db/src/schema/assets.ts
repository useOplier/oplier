import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { assetTypeEnum, environmentEnum } from "./enums";

/**
 * One canonical asset registry (doc 01 §8, doc 05 §2). Nothing in the app hardcodes asset
 * mappings — LLM #1 and the backend both check availability/support against this table.
 *
 * `assetId` is a stable human-readable slug (e.g. "test_aapl") used as the primary key and
 * referenced everywhere else (systems, swaps, positions, transactions) instead of a UUID,
 * since doc 05 §2's example keys the registry by this id directly.
 *
 * Environment-based swap (doc 01 §12): TESTNET rows hold mock assets (tAAPL, tMETA, ...),
 * MAINNET rows hold real xStocks/RWA assets. Same table, `environment` column distinguishes
 * them — this avoids maintaining two separate registries/schemas per doc 01 §12's explicit
 * goal of "avoid building a separate demo version."
 */
export const assetRegistry = pgTable(
  "asset_registry",
  {
    assetId: text("asset_id").primaryKey(),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetType: assetTypeEnum("asset_type").notNull(),
    /** Reference asset this token tracks 1:1, e.g. "AAPL" for tAAPL. Null for stablecoins. */
    underlyingAsset: text("underlying_asset"),
    /** Pyth price feed id used as the application's reference price source (doc 05 §4). */
    priceFeedId: text("price_feed_id"),
    tokenAddress: text("token_address").notNull(),
    network: text("network").notNull(),
    environment: environmentEnum("environment").notNull(),
    decimals: integer("decimals").notNull(),
    availability: boolean("availability").notNull().default(true),
    /** e.g. ["BUY","SELL"] — LLM #1 checks this before proposing an action for the asset. */
    supportedActions: jsonb("supported_actions").notNull().default(sql`'[]'::jsonb`),
    /** Array of other `asset_id`s this asset can be swapped against. */
    tradingPairs: jsonb("trading_pairs").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    symbolEnvironmentUnique: unique("asset_registry_symbol_environment_unique").on(
      table.symbol,
      table.environment,
    ),
  }),
);
