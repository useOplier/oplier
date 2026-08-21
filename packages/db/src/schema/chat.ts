import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { chatRoleEnum } from "./enums";
import { users } from "./users";

/**
 * Multiple independent conversations per user, generated titles (doc 02 "Chat"). No
 * automatic expiration/archiving — chats persist indefinitely until the user explicitly and
 * irreversibly deletes them (locked decision from the planning thread, not yet in docs
 * 01-08 — see Part A brief's "New product decision to incorporate").
 */
export const chats = pgTable("chats", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address")
    .notNull()
    .references(() => users.walletAddress, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `onDelete: "cascade"` on `chatId` is what makes chat deletion (delete chat -> delete its
 * messages + compacted context) a straightforward single-row delete on `chats`, per the
 * brief's explicit requirement. Deleting a chat never touches `memory_summary` — there is no
 * FK relationship between chats and memory at all (see memory.ts).
 */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: chatRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    toolResults: jsonb("tool_results"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatCreatedAtIdx: index("chat_messages_chat_id_created_at_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

/**
 * LLM #3's compacted representation of older same-chat messages (doc 03 "Incremental
 * compaction" — "Older portions are compacted as they leave direct recent-message context").
 * `coversUpToMessageId` is the watermark: the newest original message folded into this
 * summary, so the backend knows which messages are still owed to LLM #1 verbatim vs. already
 * represented here.
 */
export const chatCompactedContext = pgTable(
  "chat_compacted_context",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    coversUpToMessageId: uuid("covers_up_to_message_id").references(() => chatMessages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatCreatedAtIdx: index("chat_compacted_context_chat_id_created_at_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);
