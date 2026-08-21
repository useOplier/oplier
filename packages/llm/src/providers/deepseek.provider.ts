import { OpenAICompatibleProvider } from "./openai-compatible-base";

/**
 * DeepSeek's API is OpenAI-compatible (https://api.deepseek.com). Default model per env var so
 * a pricing-tier change (chat vs reasoner) doesn't need a code change.
 *
 * THINKING MODE: current v4 models think by default — the response carries `reasoning_content`
 * alongside `content`, and two real failure modes follow (both seen live 2026-08-21):
 *   1. Reasoning burns the max_tokens budget before any answer is emitted → content comes back
 *      empty with finish_reason=length → the chat stores a blank assistant message.
 *   2. Replaying an assistant turn that was generated with thinking REQUIRES passing its
 *      reasoning_content back, or the API rejects the request with HTTP 400.
 * So thinking is DISABLED by default here. Set DEEPSEEK_THINKING=enabled to opt back in (only
 * sensible together with a much larger token budget and reasoning replay support).
 */
export function createDeepSeekProvider(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
  const thinkingEnabled = (env.DEEPSEEK_THINKING ?? "disabled").toLowerCase() === "enabled";
  return new OpenAICompatibleProvider({
    providerName: "deepseek",
    baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
    model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
    extraBody: { thinking: { type: thinkingEnabled ? "enabled" : "disabled" } },
  });
}