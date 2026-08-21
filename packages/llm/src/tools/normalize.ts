/**
 * packages/llm/src/tools/normalize.ts
 *
 * The critical piece flagged by the brief: translate our common `ToolDefinition[]` into each
 * provider's function-calling request shape, and normalize each provider's raw tool-call
 * response back into `ToolCall[]`. Every adapter (providers/*.provider.ts) calls into this file
 * instead of doing its own ad hoc shaping — keeps the two DeepSeek/Groq paths and the one Gemini
 * path each defined exactly once.
 *
 * VERIFICATION STATUS: shapes below are built from each provider's *published* function-calling
 * documentation, not from a live call — this sandbox has no network access to actually invoke
 * DeepSeek/Gemini/Groq and inspect a real response. See BENCHMARK_NOTES.md. Before trusting this
 * in production: call each provider once with a multi-tool prompt and diff the real response
 * against what `normalizeXTools` below assumes. Flagging this explicitly rather than presenting
 * untested shape-guessing as verified fact (source-hierarchy discipline applies to this repo's
 * own docs, not just to what LLM #1 tells end users).
 */

import type { ToolCall, ToolDefinition } from "../types";
import { toGeminiFunctionParameters, toOpenAIFunctionParameters } from "./schema-convert";

// ---------------------------------------------------------------------------------------------
// Request-side: our tools -> provider format
// ---------------------------------------------------------------------------------------------

/** DeepSeek and Groq are both OpenAI-compatible chat-completions APIs — same tool shape. */
export function toOpenAICompatibleTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toOpenAIFunctionParameters(t.inputSchema),
    },
  }));
}

/** Gemini groups all function declarations under a single `tools[0].functionDeclarations`
 * entry — NOT one tools[] entry per function like the OpenAI convention. Getting this wrong
 * (one entry per function) is a common mistake worth calling out since it will look like it
 * works with 1 tool and silently break with >1. */
export function toGeminiTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: toGeminiFunctionParameters(t.inputSchema),
      })),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Response-side: provider's raw tool-call shape -> ToolCall[]
// ---------------------------------------------------------------------------------------------

interface OpenAICompatToolCallRaw {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is a JSON string
}

/** Shared by DeepSeek and Groq: `choices[0].message.tool_calls`. */
export function normalizeOpenAICompatToolCalls(
  raw: OpenAICompatToolCallRaw[] | undefined | null,
): ToolCall[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((tc) => {
    let input: unknown = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch (err) {
      // A provider returning malformed JSON in `arguments` is a real failure mode (seen in the
      // wild across OpenAI-compatible providers under load). Per doc 03 "tool reliability": do
      // not fabricate a result — surface this as a distinguishable error, don't silently coerce
      // to {}.
      throw new Error(
        `normalizeOpenAICompatToolCalls: malformed JSON arguments for tool "${tc.function.name}": ${String(err)}`,
      );
    }
    return { id: tc.id, name: tc.function.name, input };
  });
}

interface GeminiFunctionCallRaw {
  name: string;
  args: Record<string, unknown>;
}

/** The thoughtSignature lives on the PART, next to functionCall — not inside it. It MUST be
 * carried back on the replayed assistant turn (see ToolCall.thoughtSignature in types.ts). */
type GeminiFunctionCallPart = { functionCall?: GeminiFunctionCallRaw; thoughtSignature?: string };

/** Gemini has no per-call id in the response (`candidates[0].content.parts[].functionCall`).
 * We synthesize a stable id (name + index) so downstream code that correlates tool results by
 * id works uniformly across all three providers — see ChatMessage.toolCallId in types.ts. */
export function normalizeGeminiToolCalls(
  parts: Array<{ functionCall?: GeminiFunctionCallRaw; thoughtSignature?: string }>,
): ToolCall[] {
  const calls = parts.filter((p): p is { functionCall: GeminiFunctionCallRaw; thoughtSignature?: string } =>
    Boolean(p.functionCall),
  );
  return calls.map((p, idx) => ({
    id: `gemini_${p.functionCall.name}_${idx}`,
    name: p.functionCall.name,
    input: p.functionCall.args ?? {},
    ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
  }));
}
