import { z } from "zod";
import { chatRoleEnum } from "@oplier/db";

/**
 * `chatRoleEnum` is imported from @oplier/db (the pgEnum's own value list) rather than
 * re-declared here, so this can never silently drift from the real DB enum the way the
 * condition-type/amount-type enums almost did before Part A's real files arrived.
 */
const chatRoleValues = chatRoleEnum.enumValues;

export const chatSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string().datetime(),
  lastMessageAt: z.string().datetime(),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

export const chatsListResponseSchema = z.object({
  items: z.array(chatSummarySchema),
});
export type ChatsListResponse = z.infer<typeof chatsListResponseSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(chatRoleValues),
  content: z.string(),
  toolCalls: z.unknown().nullable(),
  toolResults: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

/** GET /chats/:id — full, unpaginated message history. See API_CONTRACT.md for why. */
export const chatDetailResponseSchema = chatSummarySchema.extend({
  messages: z.array(chatMessageSchema),
});
export type ChatDetailResponse = z.infer<typeof chatDetailResponseSchema>;

/** POST /chats — no request body; title is always the generated-later placeholder at creation. */
export const createChatResponseSchema = chatSummarySchema;
export type CreateChatResponse = z.infer<typeof createChatResponseSchema>;

export const sendChatMessageRequestSchema = z.object({
  content: z.string().min(1).max(8000),
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageRequestSchema>;

export const sendChatMessageResponseSchema = z.object({
  userMessage: chatMessageSchema,
  assistantMessage: chatMessageSchema,
  /** Echoes the chat's current title/lastMessageAt, which this call may have just updated. */
  chat: chatSummarySchema,
});
export type SendChatMessageResponse = z.infer<typeof sendChatMessageResponseSchema>;
