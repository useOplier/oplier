/**
 * packages/llm/src/services/compaction.service.ts
 */

import type { LLMProvider } from "../types";
import { buildLLM3SystemPrompt } from "../prompts/llm3-system-prompt";
import type { ChatMessageRecord } from "../context/assemble-context";

export interface CompactionInput {
  previousCompactedContext: string;
  messagesToCompact: ChatMessageRecord[];
  deps: {
    provider: LLMProvider;
    maxOutputTokens?: number;
  };
}

export interface CompactionOutput {
  compactedText: string;
  usage: { inputTokens: number; outputTokens: number };
}

function renderMessagesForCompaction(messages: ChatMessageRecord[]): string {
  return messages
    .map((m) => {
      const roleLabel = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Tool";
      return `${roleLabel}: ${m.content}`;
    })
    .join("\n");
}

/** Implements Part G brief's `compactChat()` deliverable. Never touches cross-chat Memory —
 * strictly single-chat scope, enforced simply by never taking a Memory Summary as input here. */
export async function compactChat(input: CompactionInput): Promise<CompactionOutput> {
  const systemPrompt = buildLLM3SystemPrompt();
  const userContent = [
    input.previousCompactedContext
      ? `Previous compacted summary (extend/merge this, don't discard it):\n${input.previousCompactedContext}`
      : "No previous compacted summary exists yet — this is the first compaction for this chat.",
    "",
    "Messages to compact:",
    renderMessagesForCompaction(input.messagesToCompact),
  ].join("\n");

  const result = await input.deps.provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    maxTokens: input.deps.maxOutputTokens ?? 800,
    temperature: 0.1,
  });

  if (!result.text || !result.text.trim()) {
    // Doc 03: LLM #3 has one job. A tool call or empty response here means something is
    // misconfigured (LLM #3 should never be given tools) — surface loudly rather than silently
    // keeping the old compacted context and hiding a broken compaction pass.
    throw new Error("compactChat: provider returned no text output");
  }

  return {
    compactedText: result.text.trim(),
    usage: result.usage,
  };
}
