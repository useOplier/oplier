/**
 * packages/llm/src/providers/openai-compatible-base.ts
 *
 * Shared implementation for DeepSeek and Groq: both expose an OpenAI-compatible
 * `/chat/completions` endpoint. This base class holds everything that's actually identical
 * between them (request shaping, response parsing, tool-call normalization) so
 * deepseek.provider.ts and groq.provider.ts are just config (base URL, default model, API key
 * env var). Do NOT assume this covers Gemini too — see gemini.provider.ts's own header comment
 * for why it doesn't share this base.
 */

import type { ChatMessage, CompletionParams, CompletionResult, LLMProvider, ProviderName } from "../types";
import { LLMProviderError } from "../types";
import { normalizeOpenAICompatToolCalls, toOpenAICompatibleTools } from "../tools/normalize";

export interface OpenAICompatibleConfig {
  providerName: Extract<ProviderName, "deepseek" | "groq">;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Merged verbatim into every request body — provider-specific knobs (e.g. DeepSeek's
   * `thinking: {type: "disabled"}`). Keys here win over the base's own fields. */
  extraBody?: Record<string, unknown>;
}

function toOpenAIMessages(systemPrompt: string, messages: ChatMessage[]) {
  const out: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      });
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly providerName: ProviderName;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly extraBody: Record<string, unknown>;

  constructor(config: OpenAICompatibleConfig) {
    this.providerName = config.providerName;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.extraBody = config.extraBody ?? {};
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(params.systemPrompt, params.messages),
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.2,
      ...this.extraBody,
    };
    if (params.tools?.length) {
      body.tools = toOpenAICompatibleTools(params.tools);
      body.tool_choice = "auto";
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LLMProviderError(this.providerName, "network error calling chat/completions", err);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "<unreadable body>");
      throw new LLMProviderError(this.providerName, `HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new LLMProviderError(this.providerName, "response had no choices[0]");
    }

    // content is a string in the classic shape, but some OpenAI-compatible models return it as
    // an array of typed parts ({type:"text",text}) — flatten both to a plain string.
    const rawContent = choice.message?.content;
    const text = Array.isArray(rawContent)
      ? rawContent
          .filter((p: any) => p?.type === "text" && typeof p.text === "string")
          .map((p: any) => p.text)
          .join("\n") || undefined
      : (rawContent ?? undefined);

    return {
      text,
      toolCalls: normalizeOpenAICompatToolCalls(choice.message?.tool_calls),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      rawFinishReason: choice.finish_reason,
    };
  }
}
