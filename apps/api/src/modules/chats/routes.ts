import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { chats, chatMessages, type Database } from "@oplier/db";
import {
  chatsListResponseSchema,
  chatDetailResponseSchema,
  createChatResponseSchema,
  sendChatMessageRequestSchema,
  sendChatMessageResponseSchema,
  ApiError,
  type ChatMessageDto,
  type ChatSummary,
} from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";
import { runConversationTurnAdapter } from "./run-conversation-turn.adapter.js";

/**
 * `chats.title` is NOT NULL in Part A's real schema (doc 02 "Generated chat titles" implies
 * a title arrives later, not at creation) — so every new chat starts with this placeholder,
 * and this specific string is what `run-conversation-turn.adapter.ts`'s `suggestedTitle`
 * check compares against before overwriting it. Change it in exactly one place if needed.
 */
const DEFAULT_CHAT_TITLE = "New chat";

function toChatSummary(row: typeof chats.$inferSelect): ChatSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
  };
}

function toChatMessageDto(row: typeof chatMessages.$inferSelect): ChatMessageDto {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: row.toolCalls,
    toolResults: row.toolResults,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireOwnedChat(db: Database, walletAddress: string, chatId: string) {
  const rows = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.walletAddress, walletAddress)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("NOT_FOUND", `Chat "${chatId}" not found.`);
  }
  return row;
}

export default async function chatsRoutes(fastify: FastifyInstance): Promise<void> {
  /** GET /chats — doc 02 "Multiple independent conversations." List, newest activity first. */
  fastify.get("/chats", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const rows = await fastify.db
      .select()
      .from(chats)
      .where(eq(chats.walletAddress, walletAddress))
      .orderBy(desc(chats.lastMessageAt));
    reply.send(chatsListResponseSchema.parse({ items: rows.map(toChatSummary) }));
  });

  /** POST /chats — no request body; the real title arrives later via a message exchange. */
  fastify.post("/chats", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const [row] = await fastify.db
      .insert(chats)
      .values({ walletAddress, title: DEFAULT_CHAT_TITLE })
      .returning();
    if (!row) throw new ApiError("INTERNAL_ERROR", "Failed to create chat.");
    reply.status(201).send(createChatResponseSchema.parse(toChatSummary(row)));
  });

  /**
   * GET /chats/:id — doc 01 §14 AI Chat screen. Returns the FULL message history, unpaginated
   * — a deliberate simplification, not an oversight (see API_CONTRACT.md). doc 03's
   * compaction (LLM #3) is a separate concern from what the frontend renders: it manages what
   * LLM #1 reads for its own context budget, not what a human scrolling the chat sees, so it
   * doesn't reduce what this endpoint needs to return.
   */
  fastify.get<{ Params: { id: string } }>(
    "/chats/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const chat = await requireOwnedChat(fastify.db, walletAddress, request.params.id);
      const messageRows = await fastify.db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chat.id))
        .orderBy(chatMessages.createdAt);

      reply.send(
        chatDetailResponseSchema.parse({
          ...toChatSummary(chat),
          messages: messageRows.map(toChatMessageDto),
        }),
      );
    },
  );

  /**
   * DELETE /chats/:id — cascades to chat_messages/chat_compacted_context (doc 03 "locked
   * decision... chats persist indefinitely until the user explicitly and irreversibly deletes
   * them"). Never touches memory_summary — memory.ts's schema comment is explicit there's no
   * FK path for a cascade to travel through, by design (doc 02 "One persistent Memory profile
   * shared across chats").
   */
  fastify.delete<{ Params: { id: string } }>(
    "/chats/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      await requireOwnedChat(fastify.db, walletAddress, request.params.id);
      await fastify.db.delete(chats).where(eq(chats.id, request.params.id));
      reply.status(204).send();
    },
  );

  /**
   * POST /chats/:id/messages — the actual conversation turn. Persistence (both messages,
   * title, lastMessageAt) is owned entirely by this route; `runConversationTurnAdapter` is
   * asked only to compute the assistant's reply. See run-conversation-turn.adapter.ts for the
   * full, prominently-flagged list of what's confirmed vs. still unverified about that call.
   */
  fastify.post<{ Params: { id: string } }>(
    "/chats/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const body = sendChatMessageRequestSchema.parse(request.body);
      const chat = await requireOwnedChat(fastify.db, walletAddress, request.params.id);

      const [userMessageRow] = await fastify.db
        .insert(chatMessages)
        .values({ chatId: chat.id, role: "user", content: body.content })
        .returning();
      if (!userMessageRow) throw new ApiError("INTERNAL_ERROR", "Failed to persist user message.");

      // requireAuth verifies the bearer token but doesn't retain the raw string on `request`
      // (auth-plugin.ts only exposes the decoded { walletAddress }) — re-extracted here rather
      // than changing that shared plugin, since `ReferenceApiClient` (packages/llm) needs the
      // literal token to attach as its own Authorization header on calls back into this same API.
      const accessToken = request.headers.authorization!.slice("Bearer ".length);

      const result = await runConversationTurnAdapter({
        db: fastify.db,
        accessToken,
        walletAddress,
        chatId: chat.id,
        userMessage: body.content,
      });

      const [assistantMessageRow] = await fastify.db
        .insert(chatMessages)
        .values({
          chatId: chat.id,
          role: "assistant",
          content: result.assistantMessage,
          toolCalls: result.toolCalls ?? null,
          toolResults: result.toolResults ?? null,
        })
        .returning();
      if (!assistantMessageRow) {
        throw new ApiError("INTERNAL_ERROR", "Failed to persist assistant message.");
      }

      const chatPatch: Partial<typeof chats.$inferInsert> = { lastMessageAt: new Date() };
      if (result.suggestedTitle && chat.title === DEFAULT_CHAT_TITLE) {
        chatPatch.title = result.suggestedTitle;
      }
      const [updatedChat] = await fastify.db
        .update(chats)
        .set(chatPatch)
        .where(eq(chats.id, chat.id))
        .returning();

      reply.send(
        sendChatMessageResponseSchema.parse({
          userMessage: toChatMessageDto(userMessageRow),
          assistantMessage: toChatMessageDto(assistantMessageRow),
          chat: toChatSummary(updatedChat ?? chat),
        }),
      );
    },
  );
}