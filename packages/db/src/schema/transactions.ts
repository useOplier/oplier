import { bigint, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assetRegistry } from "./assets";
import { transactionSourceEnum, txStatusEnum } from "./enums";
import { executions } from "./executions";
import { systems } from "./systems";
import { users } from "./users";

/**
 * Full transaction record backing the Activity screen (doc 06 §6, doc 05 §16). Covers both
 * System-triggered swaps (`source: "SYSTEM"`, linked via `executionId`) and one-off
 * Chat-approved transactions (`source: "ONE_OFF"`, doc 02 "One-off transactions" — no
 * `executionId`/`systemId`).
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address")
      .notNull()
      .references(() => users.walletAddress, { onDelete: "cascade" }),
    source: transactionSourceEnum("source").notNull(),
    executionId: uuid("execution_id").references(() => executions.id, { onDelete: "set null" }),
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "set null" }),
    txHash: text("tx_hash"),
    status: txStatusEnum("status").notNull().default("PENDING"),
    blockNumber: bigint("block_number", { mode: "number" }),
    sourceAsset: text("source_asset")
      .notNull()
      .references(() => assetRegistry.assetId),
    destinationAsset: text("destination_asset")
      .notNull()
      .references(() => assetRegistry.assetId),
    amountIn: numeric("amount_in", { precision: 38, scale: 18 }),
    amountOut: numeric("amount_out", { precision: 38, scale: 18 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    txHashIdx: index("transactions_tx_hash_idx").on(table.txHash),
    walletTimestampIdx: index("transactions_wallet_timestamp_idx").on(
      table.walletAddress,
      table.timestamp,
    ),
  }),
);
