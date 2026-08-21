/**
 * packages/llm/src/types.ts
 *
 * Core provider-abstraction contract for Part G. Nothing outside this file (and
 * providers/factory.ts, which is the one allowed switch point) should import a vendor SDK
 * directly. This interface is intentionally identical to the shape locked in
 * 00_MASTER_BUILD_PLAN_2_.md's "LLM Provider" section — do not drift from it without updating
 * the master plan.
 */

import type { ZodTypeAny } from "zod";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  /** Plain text content. Empty string is valid for an assistant message that is pure tool calls. */
  content: string;
  /**
   * Present when role === "assistant" and the model chose to call one or more tools instead of
   * (or in addition to) responding with text.
   */
  toolCalls?: ToolCall[];
  /**
   * Present when role === "tool" — the result of a previously requested tool call, fed back to
   * the model. `toolCallId` lets providers that require correlation (all three do, in one form
   * or another) match the result to the request.
   */
  toolCallId?: string;
  /** Tool name, required alongside role === "tool" for providers (Gemini) that key on name. */
  name?: string;
}

export interface ToolCall {
  /** Provider-assigned call id where the provider has one (OpenAI-compatible APIs). Synthesized
   * by the adapter for providers that don't (Gemini has no call id — see gemini.provider.ts). */
  id: string;
  name: string;
  input: unknown;
  /**
   * GEMINI-SPECIFIC, must round-trip: Gemini 3+ models attach an opaque `thoughtSignature` to
   * function-call parts, and REPLAYING a conversation turn whose function calls lack their
   * original signature is rejected with HTTP 400 ("Function call is missing a thought_signature").
   * Providers without this concept simply never set or read it.
   */
  thoughtSignature?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** Zod schema is the single source of truth; each adapter converts it to the provider's
   * expected function-calling schema shape via tools/schema-convert.ts. Never hand-write a
   * second JSON schema for the same tool. */
  inputSchema: ZodTypeAny;
}

export interface CompletionParams {
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
  /** 0-1, provider default used if omitted. Kept low (see role configs) — this is a financial
   * product; we want low-variance, source-grounded completions, not creative ones. */
  temperature?: number;
}

export interface CompletionResult {
  text?: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Raw provider finish reason, kept for logging/debugging only — never branched on outside
   * the adapter that produced it, since the values aren't normalized across providers. */
  rawFinishReason?: string;
}

export interface LLMProvider {
  readonly providerName: "deepseek" | "gemini" | "groq";
  complete(params: CompletionParams): Promise<CompletionResult>;
}

/** The three roles this package implements. Matches LLM1_PROVIDER / LLM2_PROVIDER / LLM3_PROVIDER. */
export type LLMRole = "LLM1" | "LLM2" | "LLM3";

export type ProviderName = "deepseek" | "gemini" | "groq";

export class LLMProviderError extends Error {
  constructor(
    public readonly providerName: ProviderName,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${providerName}] ${message}`);
    this.name = "LLMProviderError";
  }
}
