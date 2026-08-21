/**
 * packages/llm/src/services/memory.service.ts
 */

import type { LLMProvider } from "../types";
import { buildLLM2SystemPrompt } from "../prompts/llm2-system-prompt";

export interface UpdateMemoryInput {
  userMessage: string;
  currentMemorySummary: string;
  /** Relevant same-chat context, only when needed to interpret the message (doc 03: "when
   * needed" — pass "" when the message is self-contained; don't default to sending the whole
   * chat, that reintroduces the cost problem this role exists to avoid). */
  relevantSameChatContext?: string;
  deps: {
    provider: LLMProvider;
    /** Backend-enforced max size (schema: memory_summary column). Passed through to the prompt
     * so LLM #2 self-consolidates within budget rather than the backend truncating mid-sentence
     * after the fact. */
    maxSummaryChars: number;
  };
}

export type UpdateMemoryOutput =
  | { memoryChanged: false }
  | { memoryChanged: true; updatedProfile: string };

/** Runs on every user message per doc 03 — the caller (apps/api) is responsible for actually
 * invoking this unconditionally; this function does not itself decide whether to run, only
 * what to do once invoked. */
export async function updateMemory(input: UpdateMemoryInput): Promise<UpdateMemoryOutput> {
  const systemPrompt = buildLLM2SystemPrompt({ maxSummaryChars: input.deps.maxSummaryChars });

  const userContent = [
    `Current Memory Summary:\n${input.currentMemorySummary || "(empty — no memory yet)"}`,
    input.relevantSameChatContext ? `\nRelevant same-chat context:\n${input.relevantSameChatContext}` : "",
    `\nNew user message:\n${input.userMessage}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await input.deps.provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    maxTokens: Math.ceil(input.deps.maxSummaryChars / 3), // rough chars->tokens headroom
    temperature: 0.1,
  });

  return parseMemoryOutput(result.text ?? "", input.deps.maxSummaryChars);
}

/** Exported for unit testing the parsing/truncation logic independent of a live provider. */
export function parseMemoryOutput(rawText: string, maxSummaryChars: number): UpdateMemoryOutput {
  const cleaned = rawText.trim().replace(/^```(json)?/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    // Doc 03: "Backend validates and saves it." A response that isn't valid JSON fails
    // validation — do not guess intent from prose, do not save. Fail closed (no memory change)
    // rather than fail open (saving something unvalidated).
    throw new Error(`updateMemory: provider did not return valid JSON: ${String(err)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as any).memory_changed !== "boolean"
  ) {
    throw new Error("updateMemory: response missing/invalid `memory_changed` boolean");
  }

  const obj = parsed as { memory_changed: boolean; updated_profile?: unknown };

  if (!obj.memory_changed) {
    return { memoryChanged: false };
  }

  if (typeof obj.updated_profile !== "string" || !obj.updated_profile.trim()) {
    throw new Error("updateMemory: memory_changed=true but updated_profile is missing/empty");
  }

  // Backend-side hard enforcement of the size cap (doc 03: "Backend enforces a maximum size").
  // LLM #2 is instructed to self-consolidate within budget; this is the safety net if it doesn't.
  const updatedProfile =
    obj.updated_profile.length > maxSummaryChars
      ? obj.updated_profile.slice(0, maxSummaryChars)
      : obj.updated_profile;

  return { memoryChanged: true, updatedProfile };
}
