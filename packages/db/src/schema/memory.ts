import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One row per user (doc 03 LLM #2): the single connected Memory Summary, continuously
 * overwritten by LLM #2 — explicitly "not an append-only log... not a transcript, not a
 * collection of slots" per the brief. `memoryEnabled` backs the Settings screen's memory
 * on/off toggle (doc 06 §7).
 *
 * Deliberately has NO foreign key to `chats` or anything chat-scoped — memory is
 * cross-chat, shared, and per-user only (doc 02 "One persistent Memory profile shared across
 * chats"). This also structurally guarantees the brief's requirement that chat deletion must
 * never cascade into memory: there is no relationship for a cascade to travel through.
 */
export const memorySummary = pgTable("memory_summary", {
  walletAddress: text("wallet_address")
    .primaryKey()
    .references(() => users.walletAddress, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
