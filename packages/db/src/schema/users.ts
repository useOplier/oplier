import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Wallet-only auth (doc 08 §6): no username/email/password. The wallet address IS the
 * user's identity, so it is used directly as the primary key rather than wrapping it behind
 * a surrogate UUID. Every other table that needs an owner column references this column
 * directly (`wallet_address`), matching Part A brief's RLS-readiness requirement.
 *
 * Store addresses lowercased at the application layer (EVM addresses are case-insensitive)
 * so equality/lookups are consistent.
 */
export const users = pgTable("users", {
  walletAddress: text("wallet_address").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
