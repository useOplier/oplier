/**
 * packages/llm/src/services/conversation.service.ts
 *
 * Implements runConversationTurn(), the Part G brief's deliverable #3 for LLM #1. This function
 * owns the tool-call loop: call the provider, if it returns tool calls execute them against the
 * injected ApiClient (which wraps Part B's real REST endpoints — see api-client.ts's header),
 * feed results back, repeat until the model returns text or a hard iteration cap is hit.
 *
 * LLM #1 NEVER calls Part E/F, the database, or anything else directly (doc 03 "Backend
 * authority") — the only thing this file is allowed to call besides the LLMProvider is
 * `ApiClient`, which is intentionally the *sole* injected side-effect surface. Review any PR
 * that adds a second one.
 */

import type { ChatMessage, LLMProvider, ToolCall } from "../types";
import { llm1Tools } from "../tools/tool-definitions";
import { buildLLM1SystemPrompt } from "../prompts/llm1-system-prompt";
import type { ApiClient } from "./api-client";
import type { TavilyClient } from "./tavily-client";

const MAX_TOOL_ROUNDS = 6; // doc 03 "tool reliability": stop after repeated rounds, don't loop forever.

export interface RunConversationTurnInput {
  userMessage: string;
  /** Output of assembleContext() for this turn — already includes compacted context + recent
   * verbatim messages, per the context-assembly pipeline. Does NOT yet include userMessage
   * itself; this function appends it. */
  assembledMessages: ChatMessage[];
  memorySummary: string;
  currentDateTimeIso: string;
  appTimezone: string;
  environment: "TESTNET" | "MAINNET";
  deps: {
    provider: LLMProvider;
    apiClient: ApiClient;
    /** search_web is the one tool NOT routed through apiClient — see tavily-client.ts. */
    tavilyClient: TavilyClient;
    maxOutputTokens?: number;
  };
}

export interface RunConversationTurnOutput {
  assistantText: string;
  /** Full tool-call trace for logging/debugging — never shown to the end user (doc 03: "Not
   * expose internal reasoning or tool calls"). */
  toolTrace: Array<{ call: ToolCall; resultSummary: string; isError: boolean }>;
  usage: { inputTokens: number; outputTokens: number };
}

export async function runConversationTurn(input: RunConversationTurnInput): Promise<RunConversationTurnOutput> {
  const systemPrompt = buildLLM1SystemPrompt({
    currentDateTimeIso: input.currentDateTimeIso,
    appTimezone: input.appTimezone,
    environment: input.environment,
  });

  // Memory Summary is injected as a labeled block ahead of chat history, per the source
  // hierarchy (backend/live data > ... > Memory) — it is clearly demarcated so the model doesn't
  // confuse it with authoritative current data or the user's current message.
  const messages: ChatMessage[] = [
    ...(input.memorySummary
      ? [{ role: "user" as const, content: `[Persistent Memory Summary — background context only, current message overrides it]\n${input.memorySummary}` }]
      : []),
    ...input.assembledMessages,
    { role: "user", content: input.userMessage },
  ];

  const toolTrace: RunConversationTurnOutput["toolTrace"] = [];
  let totalUsage = { inputTokens: 0, outputTokens: 0 };
  const seenSystemIdsThisTurn = new Set<string>(); // multi-task guard support (see below)

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await input.deps.provider.complete({
      systemPrompt,
      messages,
      tools: llm1Tools,
      // 1024 was too small for reasoning-style models (the reasoning alone exhausted it,
      // returning empty content) and cramped multi-tool turns generally.
      maxTokens: input.deps.maxOutputTokens ?? 4096,
    });

    totalUsage = {
      inputTokens: totalUsage.inputTokens + result.usage.inputTokens,
      outputTokens: totalUsage.outputTokens + result.usage.outputTokens,
    };

    if (!result.toolCalls || result.toolCalls.length === 0) {
      // GUARD against blank replies: a model can return neither text nor tool calls (e.g. a
      // thinking-mode response truncated by max_tokens before any content — seen live with
      // deepseek-v4-flash). Storing "" renders as an empty bubble in the UI; surface an honest
      // retry prompt instead. Never fabricate portfolio data here.
      const text = result.text?.trim();
      return {
        assistantText:
          text && text.length > 0
            ? text
            : "I wasn't able to compose a reply just now — could you send that again?",
        toolTrace,
        usage: totalUsage,
      };
    }

    messages.push({ role: "assistant", content: result.text ?? "", toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      // "One task must not silently authorize another" (doc 03): track systemIds acted on by a
      // mutating call this turn so a later mutating call on the same id in the same turn is at
      // least visible in the trace for review — the model is instructed not to chain unconfirmed
      // actions, this is a defense-in-depth logging hook, not a hard block (a legitimate flow
      // like pause_system then resume_system on the same id in one turn is valid and should not
      // be blocked).
      const systemIdArg = (call.input as any)?.systemId;
      if (systemIdArg) seenSystemIdsThisTurn.add(systemIdArg);

      let resultText: string;
      let isError = false;
      try {
        const toolResult =
          call.name === "search_web"
            ? await input.deps.tavilyClient.search((call.input as { query: string }).query)
            : await input.deps.apiClient.callTool(call.name, call.input);
        resultText = JSON.stringify(toolResult);
      } catch (err: any) {
        isError = true;
        // Surface the backend's real error shape (API_CONTRACT.md §2) to the model so it can
        // report UNSUPPORTED_CAPABILITY/UNSUPPORTED_ASSET/etc. distinctly rather than treating
        // every failure as generic — never fabricate a success.
        resultText = JSON.stringify({
          error: {
            code: err?.code ?? "INTERNAL_ERROR",
            message: err?.message ?? "Tool call failed",
          },
        });
      }

      toolTrace.push({ call, resultSummary: resultText.slice(0, 500), isError });
      messages.push({ role: "tool", content: resultText, toolCallId: call.id, name: call.name });
    }
  }

  // Hit MAX_TOOL_ROUNDS without a final text response — doc 03 "stop after repeated failure
  // rather than endlessly retrying." Return a plain, honest message rather than nothing.
  return {
    assistantText:
      "I wasn't able to finish putting that together after several tool calls — could you rephrase or split that into smaller requests?",
    toolTrace,
    usage: totalUsage,
  };
}
