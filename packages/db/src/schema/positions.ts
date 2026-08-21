import { numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { assetRegistry } from "./assets";
import { positionStatusEnum } from "./enums";
import { systems } from "./systems";
import { users } from "./users";

/**
 * A position is created on the first execution of a System and closed when the System
 * completes, halts, or expires (doc 06 §8).
 *
 * DESIGN DECISION (brief explicitly asks this be made explicit — see SCHEMA.md): a position
 * is scoped to (system, asset), NOT to an individual run. Cost basis represents real
 * on-chain holdings the user actually owns; those holdings don't disappear because a run
 * ended. So:
 *   - status flips OPEN -> CLOSED when the System transitions to COMPLETE / HALTED / EXPIRED.
 *   - status flips back to OPEN on the *next* execution after a reactivation (new run), and
 *     `costBasis`/`quantity` continue accumulating via weighted average (doc 04 §7) rather
 *     than resetting to zero — the reactivation reset described in doc 05 §22/§29 is about
 *     *execution* state (locks, step progress), not the user's actual asset holdings.
 *   - `closedAt` is cleared (set null) on reopen.
 * A status flag (rather than inferring "open" purely by joining to the live system status)
 * keeps the Positions screen (doc 06 §8) a simple, fast, directly-queryable list.
 */
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    walletAddress: text("wallet_address")
      .notNull()
      .references(() => users.walletAddress, { onDelete: "cascade" }),
    /**
     * SET NULL, not CASCADE: position/cost-basis history must survive System deletion
     * (doc 05 §32). Nullable so the FK action has somewhere to go.
     */
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "set null" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => assetRegistry.assetId),
    status: positionStatusEnum("status").notNull().default("OPEN"),
    /** Weighted-average cost basis across all acquisitions (doc 04 §7). */
    costBasis: numeric("cost_basis", { precision: 38, scale: 18 }).notNull().default("0"),
    quantity: numeric("quantity", { precision: 38, scale: 18 }).notNull().default("0"),
    currentValue: numeric("current_value", { precision: 38, scale: 18 }).notNull().default("0"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    systemAssetUnique: unique("positions_system_asset_unique").on(
      table.systemId,
      table.assetId,
    ),
  }),
);
