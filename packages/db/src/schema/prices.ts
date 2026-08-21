import { boolean, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assetRegistry } from "./assets";

/**
 * NOT explicitly named in the Part A brief's "Required entities" list, but doc 05 §5/§36
 * makes price storage an explicit backend responsibility ("The backend stores the latest
 * normalized price and timestamp, with historical observations stored separately") and it's
 * shared infrastructure both `api` (portfolio value, chart data) and `worker` (condition
 * evaluation, doc 04 §17) need. Added here as foundation rather than left for Part D to bolt
 * on later, since packages/db is the single shared schema both processes read/write against.
 * Flagging this addition explicitly — not a literal brief requirement.
 *
 * `assetPrices` is a single-row-per-asset latest-value cache (fast reads for condition
 * evaluation, portfolio valuation, Home screen). `assetPriceHistory` is the append-only log
 * backing charts (doc 05 §7) and ROI-over-time.
 *
 * `isStale` backs doc 05 §6: price/ROI conditions must not trigger from stale data.
 */
export const assetPrices = pgTable("asset_prices", {
  assetId: text("asset_id")
    .primaryKey()
    .references(() => assetRegistry.assetId, { onDelete: "cascade" }),
  price: numeric("price", { precision: 38, scale: 18 }).notNull(),
  source: text("source").notNull().default("pyth"),
  /** Timestamp the provider attached to this observation (distinct from `updatedAt`). */
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  isStale: boolean("is_stale").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetPriceHistory = pgTable(
  "asset_price_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assetRegistry.assetId, { onDelete: "cascade" }),
    price: numeric("price", { precision: 38, scale: 18 }).notNull(),
    source: text("source").notNull().default("pyth"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    assetObservedAtIdx: index("asset_price_history_asset_observed_at_idx").on(
      table.assetId,
      table.observedAt,
    ),
  }),
);
