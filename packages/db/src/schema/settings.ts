import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Per-user settings shown on the Settings screen (doc 06 §7): timezone and default max
 * slippage. See SCHEMA.md "Design decisions" for why timezone lives only here and not
 * duplicated onto `users`.
 *
 * Timezone: one universal app timezone, assigned automatically, user-editable (doc 02
 * "Timezone" section). Stored as an IANA tz string (e.g. "America/New_York") at the
 * application layer.
 *
 * Slippage stored in basis points (bps) to avoid floating point issues; 100 bps = 1%,
 * matching the locked MVP default (doc 05 §13, doc 06 §7).
 */
export const settings = pgTable("settings", {
  walletAddress: text("wallet_address")
    .primaryKey()
    .references(() => users.walletAddress, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  maxSlippageDefaultBps: integer("max_slippage_default_bps").notNull().default(100),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
