/**
 * packages/llm/src/providers/gemini.provider.ts
 *
 * Gemini deliberately does NOT share openai-compatible-base.ts. Three real differences, each
 * load-bearing enough that trying to force-fit Gemini through the OpenAI-shaped base would have
 * produced silent bugs rather than saved code:
 *
 *  1. Message roles: Gemini uses `user` / `model` (not `assistant`), and system instructions are
 *     a top-level `systemInstruction` field, not a message in the array.
 *  2. Tool results: fed back as a `functionResponse` part keyed by function `name`, not as a
 *     `role: "tool"` message keyed by a call id — Gemini has no call-id concept at all (see
 *     tools/normalize.ts's synthesized id).
 *  3. Function-call parts live inside `candidates[0].content.parts[]` mixed with text parts,
 *     rather than a separate `tool_calls` field alongside `content`.
 */

import type { ChatMessage, CompletionParams, CompletionResult, LLMProvider } from "../types";
import { LLMProviderError } from "../types";
import { normalizeGeminiToolCalls, toGeminiTools } from "../tools/normalize";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /**
   * Opaque Gemini-3+ "thought" signature attached to function-call (and some text) parts. When
   * history containing function calls is replayed, each functionCall part MUST carry its original
   * signature or the API rejects the request with HTTP 400 — see ToolCall.thoughtSignature.
   */
  thoughtSignature?: string;
}

function toGeminiContents(messages: ChatMessage[]): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const out: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      // Should not occur — the system prompt is passed separately (see complete() below). Guard
      // rather than silently mis-map it into a user turn.
      throw new Error("gemini.provider: system-role ChatMessage reached toGeminiContents");
    }
    if (m.role === "user") {
      // SANITIZE: a user message with undefined/empty content would serialize to a part with no
      // initialized oneof field (`{text: undefined}` → `{}` after JSON.stringify drops it), and
      // Gemini rejects the whole request with HTTP 400 "required oneof field 'data' must have
      // one initialized field" (seen live). Skip nothing-less messages entirely.
      if (!m.content) continue;
      out.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        // The original thoughtSignature MUST ride along on each replayed functionCall part —
        // omitting it makes the next round fail with HTTP 400 "Function call is missing a
        // thought_signature" (Gemini 3+ enforces this; seen live).
        parts.push({
          functionCall: { name: tc.name, args: (tc.input as Record<string, unknown>) ?? {} },
          ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
        });
      }
      // SANITIZE: an assistant message with neither text nor tool calls (e.g. an empty row
      // replayed from history) would emit `parts: []` — drop the entry rather than send a
      // content with no parts.
      if (parts.length === 0) continue;
      out.push({ role: "model", parts });
    } else if (m.role === "tool") {
      // functionResponse is keyed by *name*, correlated positionally with the preceding model
      // turn's functionCall — Gemini has no call-id, so `name` must be unambiguous within a
      // single model turn. If a future tool set allows the same tool called twice in one turn,
      // this needs the response ordered to match; not a concern for the current tool list.
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(m.content);
      } catch {
        parsed = { result: m.content };
      }
      out.push({ role: "user", parts: [{ functionResponse: { name: m.name ?? "unknown_tool", response: parsed } }] });
    }
  }
  return out;
}

export function createGeminiProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const apiKey = env.GEMINI_API_KEY;
  /**
   * Google retires Gemini model ids and returns HTTP 404 "no longer available to new users" for them,
   * so a hardcoded default rots. `gemini-2.5-flash` failed exactly that way on 2026-08-21 and Google's
   * own error named `gemini-3.6-flash` as the replacement; the previous default here (2.0-flash) is
   * older still, so it is very unlikely to resolve either.
   *
   * Prefer setting GEMINI_MODEL explicitly — the same reasoning `groq.provider.ts` already applies by
   * refusing to default at all. This default exists only so local dev boots without config.
   */
  const model = env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const baseUrl = env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  return {
    providerName: "gemini",
    async complete(params: CompletionParams): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: params.systemPrompt }] },
        contents: toGeminiContents(params.messages),
        generationConfig: {
          maxOutputTokens: params.maxTokens,
          temperature: params.temperature ?? 0.2,
        },
      };
      if (params.tools?.length) {
        body.tools = toGeminiTools(params.tools);
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new LLMProviderError("gemini", "network error calling generateContent", err);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "<unreadable body>");
        // Compact structural dump of what we sent — Gemini 400s here are almost always a
        // malformed part somewhere in the replayed history (e.g. a part with no text/
        // functionCall/functionResponse set), and the API's error only gives an index.
        const dump = (body.contents as Array<{ role: string; parts: GeminiPart[] }>)
          .map((c, ci) => {
            const parts = (c.parts ?? []).map((p) =>
              p.text !== undefined
                ? `text:${JSON.stringify(p.text.slice(0, 80))}`
                : p.functionCall
                  ? `functionCall:${p.functionCall.name}`
                  : p.functionResponse
                    ? `functionResponse:${p.functionResponse.name}`
                    : "EMPTY_PART",
            );
            return `contents[${ci}](${c.role}): [${parts.join(", ")}]`;
          })
          .join("; ");
        throw new LLMProviderError("gemini", `HTTP ${res.status}: ${errText} | sent: ${dump}`);
      }

      const data = (await res.json()) as any;
      const candidate = data.candidates?.[0];
      if (!candidate) {
        // Gemini returns 200 with no candidates on a safety block — distinguish that from a
        // real network/parse failure so callers can handle it (doc 03: don't fabricate a result).
        const blockReason = data.promptFeedback?.blockReason;
        throw new LLMProviderError(
          "gemini",
          blockReason ? `no candidates — blocked (${blockReason})` : "no candidates in response",
        );
      }

      const parts: GeminiPart[] = candidate.content?.parts ?? [];
      const textParts = parts.filter((p) => typeof p.text === "string").map((p) => p.text as string);
      const toolCalls = normalizeGeminiToolCalls(parts);

      return {
        text: textParts.length ? textParts.join("\n") : undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        rawFinishReason: candidate.finishReason,
      };
    },
  };
}
