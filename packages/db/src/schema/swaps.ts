import { integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { assetRegistry } from "./assets";
import { amountTypeEnum } from "./enums";
import { systemSteps } from "./systems";

/**
 * Exactly one swap per step (doc 04 §4-5) — enforced with a unique constraint on `stepId`
 * rather than relying on application logic alone.
 *
 * The System only stores the intended `sourceAsset`/`destinationAsset` flow — never
 * QuickSwap-specific intermediate routes (doc 05 §10: "The System does not store
 * QuickSwap-specific intermediate routes... The backend routing engine determines the
 * executable route" at execution time). Routing/path-encoding is Part F's runtime concern,
 * not part of this definition table.
 *
 * `maxSlippageBps` defaults to 100 (1%), the locked MVP default (doc 05 §13, doc 06 §7);
 * a System can override it per swap.
 */
export const swaps = pgTable("swaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  stepId: uuid("step_id")
    .notNull()
    .unique()
    .references(() => systemSteps.id, { onDelete: "cascade" }),
  sourceAsset: text("source_asset")
    .notNull()
    .references(() => assetRegistry.assetId),
  destinationAsset: text("destination_asset")
    .notNull()
    .references(() => assetRegistry.assetId),
  amountType: amountTypeEnum("amount_type").notNull(),
  /**
   * Meaning depends on `amountType`: an absolute token amount for FIXED, or a percentage
   * (0-100) for the two percentage-based types. See SCHEMA.md for the exact contract.
   */
  amountValue: numeric("amount_value", { precision: 38, scale: 18 }).notNull(),
  /** Ordering of this swap relative to the System's other swaps (doc 04 §5). */
  executionOrder: integer("execution_order").notNull(),
  maxSlippageBps: integer("max_slippage_bps").notNull().default(100),
});
