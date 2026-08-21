import { OpenAICompatibleProvider } from "./openai-compatible-base";

/**
 * Groq's API is OpenAI-compatible (https://api.groq.com/openai/v1). Model must be an
 * explicitly-set env var, not a hardcoded default — Groq's hosted open-weight model lineup
 * changes/rotates faster than DeepSeek's or Gemini's, and a stale hardcoded default here is the
 * likeliest of the three providers to silently start failing tool-calls after a model
 * deprecation. Fail loudly instead.
 */
export function createGroqProvider(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.GROQ_API_KEY;
  const model = env.GROQ_MODEL;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  if (!model) {
    throw new Error(
      "GROQ_MODEL is not set. Groq's model lineup rotates; pick a currently-supported model at " +
        "https://console.groq.com/docs/models and set it explicitly rather than relying on a " +
        "hardcoded default here.",
    );
  }
  return new OpenAICompatibleProvider({
    providerName: "groq",
    baseUrl: env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    apiKey,
    model,
  });
}
