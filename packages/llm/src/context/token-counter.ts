/**
 * packages/llm/src/context/token-counter.ts
 *
 * Doc 03 is explicit: "The backend, not LLM #3, keeps token counts" — this module is that
 * backend-side counter, called from context/assemble-context.ts.
 *
 * HONEST LIMITATION: there is no single official tokenizer covering DeepSeek + Gemini + Groq's
 * (rotating) hosted models the way `tiktoken` covers OpenAI. Building/vendoring three separate
 * real tokenizers is real work with real accuracy trade-offs per provider, and doing it without
 * being able to verify counts against a live API call (no network in this sandbox) risks
 * shipping confident-looking numbers that are actually wrong — worse than an honest estimate.
 * So: this is a conservative heuristic (~3.3 chars/token, tuned slightly low vs. the commonly
 * cited ~4 chars/token English average) plus a fixed safety margin, meant to trigger compaction
 * a little EARLY rather than risk running over a real provider's actual limit. Before production:
 * replace `estimateTokens` with each provider's real tokenizer where one is published (DeepSeek
 * publishes a tokenizer; Gemini's countTokens API can be called instead of estimated at all,
 * which is the more correct fix specifically for the Gemini role), and re-tune the margin against
 * real usage.numbers returned from actual completions (CompletionResult.usage is always the real
 * number — reconcile the estimate against it after every call and log drift).
 */

const CHARS_PER_TOKEN_ESTIMATE = 3.3;
const SAFETY_MARGIN_TOKENS = 200;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export interface ContextBudget {
  /** Total context window for the active LLM1 provider/model. Set from provider config, not
   * hardcoded here — the same code runs whichever of the three providers is configured. */
  maxContextTokens: number;
  /** Tokens reserved for the model's output — never counted as available input budget. */
  outputReservationTokens: number;
}

export function availableInputBudget(budget: ContextBudget): number {
  return budget.maxContextTokens - budget.outputReservationTokens - SAFETY_MARGIN_TOKENS;
}

export interface AssembledPieces {
  systemPrompt: string;
  memorySummary: string;
  compactedContext: string;
  recentMessagesText: string;
  currentToolResultsText: string;
}

export function totalAssembledTokens(pieces: AssembledPieces): number {
  return (
    estimateTokens(pieces.systemPrompt) +
    estimateTokens(pieces.memorySummary) +
    estimateTokens(pieces.compactedContext) +
    estimateTokens(pieces.recentMessagesText) +
    estimateTokens(pieces.currentToolResultsText)
  );
}

/** Reconciles the estimate against a real usage number returned by a completed call. Callers
 * should log a warning if drift exceeds ~15% so the estimate can be re-tuned over time — this
 * function just computes the drift, logging/alerting is the caller's (apps/api's) concern. */
export function estimationDriftRatio(estimated: number, actual: number): number {
  if (actual === 0) return 0;
  return (estimated - actual) / actual;
}
