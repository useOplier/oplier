/**
 * packages/llm/src/providers/factory.ts
 *
 * This is THE switch point (master plan, "LLM Provider" section). Nothing outside this file
 * should import a concrete provider (deepseek/gemini/groq).provider.ts directly — always go
 * through getProviderForRole(). Switching a role's provider is: change the env var, restart the
 * process. No code edit, no redeploy of different code.
 */

import type { LLMProvider, LLMRole, ProviderName } from "../types";
import { createDeepSeekProvider } from "./deepseek.provider";
import { createGeminiProvider } from "./gemini.provider";
import { createGroqProvider } from "./groq.provider";

const ROLE_ENV_VAR: Record<LLMRole, string> = {
  LLM1: "LLM1_PROVIDER",
  LLM2: "LLM2_PROVIDER",
  LLM3: "LLM3_PROVIDER",
};

// Defaults reflect the provisional benchmark decision in BENCHMARK_NOTES.md — UNVERIFIED against
// live calls (no network in this sandbox). Override via env in every real environment; do not
// treat these as a production recommendation on their own.
const ROLE_DEFAULT: Record<LLMRole, ProviderName> = {
  LLM1: "gemini",
  LLM2: "groq",
  LLM3: "groq",
};

function buildProvider(name: ProviderName, env: NodeJS.ProcessEnv): LLMProvider {
  switch (name) {
    case "deepseek":
      return createDeepSeekProvider(env);
    case "gemini":
      return createGeminiProvider(env);
    case "groq":
      return createGroqProvider(env);
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

const cache = new Map<string, LLMProvider>();

/**
 * Returns the configured LLMProvider for a role. Cached per (role, resolved provider name) pair
 * for the process lifetime — providers are stateless wrappers around fetch, safe to reuse.
 */
export function getProviderForRole(role: LLMRole, env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const envVar = ROLE_ENV_VAR[role];
  const raw = env[envVar];
  const name = (raw?.toLowerCase() as ProviderName | undefined) ?? ROLE_DEFAULT[role];

  if (!["deepseek", "gemini", "groq"].includes(name)) {
    throw new Error(
      `${envVar}="${raw}" is not a supported provider. Supported: deepseek, gemini, groq (master ` +
        `plan §1 "LLM Provider" — no Anthropic, no OpenAI, no Grok/xAI).`,
    );
  }

  const cacheKey = `${role}:${name}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, buildProvider(name, env));
  }
  return cache.get(cacheKey)!;
}

/** Test-only: clears the provider cache so a test can rebuild with different env/mocked fetch. */
export function _resetProviderCacheForTests() {
  cache.clear();
}
