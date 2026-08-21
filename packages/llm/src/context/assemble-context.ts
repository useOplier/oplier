/**
 * packages/llm/src/context/assemble-context.ts
 *
 * Implements the assembly order doc 03 implies and the Part G brief calls out as "the piece
 * most likely to drift from spec if underspecified":
 *
 *   system instructions + Memory Summary + compacted same-chat context + recent verbatim
 *   messages + current tool results + output reservation
 *
 * with backend-tracked token counting triggering LLM #3 compaction BEFORE calling LLM #1 — never
 * after, and never let LLM #1 see an over-budget context that then gets trimmed reactively.
 *
 * This module owns orchestration only; it does not itself talk to a provider — that's
 * services/compaction.service.ts (called from here) and services/conversation.service.ts (the
 * caller of this module).
 */

import type { ChatMessage } from "../types";
import { availableInputBudget, estimateTokens, totalAssembledTokens, type ContextBudget } from "./token-counter";
import { compactChat, type CompactionInput } from "../services/compaction.service";

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ChatMessage["toolCalls"];
  toolCallId?: string;
  name?: string;
  createdAt: string;
}

export interface AssembleContextParams {
  systemPrompt: string;
  memorySummary: string;
  /** Existing compacted-context row for this chat, if any (chat_compacted_context table). */
  existingCompactedContext: { text: string; coversUpToMessageId: string | null } | null;
  /** Full same-chat message history, oldest first, NOT yet trimmed to "recent". */
  allChatMessages: ChatMessageRecord[];
  /** Tool results gathered so far in the current turn (if this is a follow-up call after a tool
   * round-trip within the same turn). */
  currentToolResultsText: string;
  budget: ContextBudget;
  /** Injected so this module stays testable without a live provider — see LLM_CONTRACT.md. */
  compactionDeps: CompactionInput["deps"];
}

export interface AssembleContextResult {
  messages: ChatMessage[];
  usedCompaction: boolean;
  newCompactedContext?: { text: string; coversUpToMessageId: string };
  estimatedInputTokens: number;
}

const RECENT_TURNS_TARGET = 10; // "~8-12 turns" per doc 03, subject to budget below.

function toRecentAndOlder(messages: ChatMessageRecord[], coversUpToMessageId: string | null) {
  const startIdx = coversUpToMessageId
    ? messages.findIndex((m) => m.id === coversUpToMessageId) + 1
    : 0;
  const notYetCompacted = messages.slice(startIdx);
  // A "turn" here = one user message plus everything up to (and including) the next user
  // message's predecessor — approximate by counting user-role messages from the end.
  let userCount = 0;
  let splitIdx = notYetCompacted.length;
  for (let i = notYetCompacted.length - 1; i >= 0; i--) {
    if (notYetCompacted[i].role === "user") {
      userCount++;
      if (userCount > RECENT_TURNS_TARGET) {
        splitIdx = i + 1;
        break;
      }
    }
    splitIdx = i;
  }
  return {
    olderEligibleForCompaction: notYetCompacted.slice(0, splitIdx),
    recent: notYetCompacted.slice(splitIdx),
  };
}

export async function assembleContext(params: AssembleContextParams): Promise<AssembleContextResult> {
  const { systemPrompt, memorySummary, allChatMessages, currentToolResultsText, budget } = params;

  let compactedText = params.existingCompactedContext?.text ?? "";
  let coversUpTo = params.existingCompactedContext?.coversUpToMessageId ?? null;
  let usedCompaction = false;
  let newCompactedContext: AssembleContextResult["newCompactedContext"];

  let { olderEligibleForCompaction, recent } = toRecentAndOlder(allChatMessages, coversUpTo);

  const recentMessagesText = recent.map((m) => m.content).join("\n");
  let assembled = totalAssembledTokens({
    systemPrompt,
    memorySummary,
    compactedContext: compactedText,
    recentMessagesText,
    currentToolResultsText,
  });

  // If we're still over budget even after the recent/older split above (e.g. unusually long
  // recent messages, doc 03's explicit "compaction can happen earlier" case), compact the oldest
  // eligible slice now, before ever calling LLM #1.
  if (assembled > availableInputBudget(budget) && olderEligibleForCompaction.length > 0) {
    const result = await compactChat({
      previousCompactedContext: compactedText,
      messagesToCompact: olderEligibleForCompaction,
      deps: params.compactionDeps,
    });
    compactedText = result.compactedText;
    coversUpTo = olderEligibleForCompaction[olderEligibleForCompaction.length - 1].id;
    usedCompaction = true;
    newCompactedContext = { text: compactedText, coversUpToMessageId: coversUpTo };

    assembled = totalAssembledTokens({
      systemPrompt,
      memorySummary,
      compactedContext: compactedText,
      recentMessagesText,
      currentToolResultsText,
    });
    // Note: doc 03 §"Compaction flow" step 6 is "backend recalculates token usage" — done above.
    // We do not loop compaction repeatedly within a single turn beyond this one pass; if still
    // over budget after compacting everything eligible, that's a config problem (budget too
    // small for even the recent window) surfaced to the caller via the returned estimate, not
    // silently handled by dropping recent verbatim messages (doc 03: recent messages stay
    // verbatim).
  }

  const messages: ChatMessage[] = [];
  if (compactedText) {
    messages.push({
      role: "user",
      content: `[Earlier conversation summary]\n${compactedText}`,
    });
  }
  for (const m of recent) {
    messages.push({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls,
      toolCallId: m.toolCallId,
      name: m.name,
    });
  }

  return {
    messages,
    usedCompaction,
    newCompactedContext,
    estimatedInputTokens: assembled + estimateTokens(memorySummary),
  };
}
