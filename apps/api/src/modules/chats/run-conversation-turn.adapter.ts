import { eq, desc } from "drizzle-orm";
import {
  chatMessages,
  chatCompactedContext,
  memorySummary,
  settings,
  type Database,
} from "@oplier/db";
import {
  runConversationTurn,
  assembleContext,
  getProviderForRole,
  ReferenceApiClient,
  RealTavilyClient,
  type ChatMessageRecord,
  type TavilyClient,
} from "@oplier/llm";
import { loadEnv } from "../../config/env.js";

/**
 * ✅ RECONCILED against the real `packages/llm` source — now including the real
 * `context/assemble-context.ts`, not the "last 20 messages" simplification from two versions
 * ago. `assembleContext()` is genuinely wired: compaction, the recent/older split, and
 * `chat_compacted_context` persistence all run for real.
 *
 * `ContextBudget` (`context/token-counter.ts`) and `CompactionInput` (`services/
 * compaction.service.ts`) are now CONFIRMED shapes, not guesses — `DEFAULT_CONTEXT_BUDGET`'s
 * fields (`maxContextTokens`, `outputReservationTokens`) and `compactionDeps`'s shape
 * (`{ provider, maxOutputTokens? }`) both match the real interfaces exactly.
 *
 * Still confirmed from earlier reconciliation (unchanged): `ApiClient`/`TavilyClient`
 * injection via `ReferenceApiClient`/`RealTavilyClient`, `RunConversationTurnOutput` shape
 * `{ assistantText, toolTrace, usage }`, persistence owned entirely by `routes.ts`.
 *
 * ⚠️ STILL A PLACEHOLDER, not the shape: `DEFAULT_CONTEXT_BUDGET.maxContextTokens` is a
 * deliberately small/conservative guessed VALUE (8000), not a guessed shape — the master plan
 * explicitly leaves per-model context window sizes as a caller-supplied decision rather than
 * something this package hardcodes (deepseek/gemini/groq have very different real windows,
 * and whichever is configured for `LLM1_PROVIDER` should get a properly considered number,
 * not this placeholder).
 *
 * `estimationDriftRatio` (token-counter.ts) is what the doc comment there says apps/api
 * "should" use to log when the token estimate drifts >15% from `CompletionResult.usage`'s
 * real number — but it isn't in the `@oplier/llm` index.ts I was given, so it can't be
 * imported. Reimplemented locally below (`(estimated - actual) / actual`, identical to the
 * real file's own formula) rather than skipping the drift-logging responsibility entirely —
 * worth reconciling if the real index.ts does export it after all.
 *
 * Also imprecise: `assembleContext`'s `systemPrompt` param (used only for token-count
 * estimation, per that file's own code — never sent to a model from here) is passed as an
 * empty string, since `buildLLM1SystemPrompt` isn't part of `@oplier/llm`'s public exports
 * for `apps/api` to reuse. This will slightly undercount the real budget; flagged rather than
 * fabricating a stand-in prompt of a plausible-looking length.
 *
 * Historical `chat_messages.tool_calls` rows are NOT mapped into `ChatMessageRecord.toolCalls`
 * when reloading history — they hold `RunConversationTurnOutput.toolTrace`'s shape
 * (`{ call, resultSummary, isError }[]`), not `ChatMessage.toolCalls`'s `ToolCall[]` shape.
 * Past turns are replayed as plain text only rather than mapping an incompatible shape across.
 */

const DEFAULT_CONTEXT_BUDGET = {
  maxContextTokens: 8000,
  outputReservationTokens: 1024,
};

/** Local reimplementation of token-counter.ts's estimationDriftRatio — see file header. */
function estimationDriftRatio(estimated: number, actual: number): number {
  if (actual === 0) return 0;
  return (estimated - actual) / actual;
}

async function loadAllChatMessages(db: Database, chatId: string): Promise<ChatMessageRecord[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(chatMessages.createdAt); // oldest first — assembleContext does its own recent/older split
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function loadExistingCompactedContext(
  db: Database,
  chatId: string,
): Promise<{ text: string; coversUpToMessageId: string | null } | null> {
  const rows = await db
    .select()
    .from(chatCompactedContext)
    .where(eq(chatCompactedContext.chatId, chatId))
    .orderBy(desc(chatCompactedContext.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { text: row.summary, coversUpToMessageId: row.coversUpToMessageId };
}

async function loadMemorySummaryText(db: Database, walletAddress: string): Promise<string> {
  const rows = await db
    .select({ summary: memorySummary.summary, memoryEnabled: memorySummary.memoryEnabled })
    .from(memorySummary)
    .where(eq(memorySummary.walletAddress, walletAddress))
    .limit(1);
  const row = rows[0];
  if (!row || !row.memoryEnabled) return "";
  return row.summary;
}

async function loadAppTimezone(db: Database, walletAddress: string): Promise<string> {
  const rows = await db
    .select({ timezone: settings.timezone })
    .from(settings)
    .where(eq(settings.walletAddress, walletAddress))
    .limit(1);
  return rows[0]?.timezone ?? "UTC";
}

function createTavilyClient(): TavilyClient {
  const env = loadEnv();
  if (env.TAVILY_API_KEY) {
    return new RealTavilyClient(env.TAVILY_API_KEY);
  }
  return {
    async search() {
      return [];
    },
  };
}

export interface RunConversationTurnResult {
  assistantMessage: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  suggestedTitle?: string;
}

export async function runConversationTurnAdapter(args: {
  db: Database;
  accessToken: string;
  walletAddress: string;
  chatId: string;
  userMessage: string;
}): Promise<RunConversationTurnResult> {
  const env = loadEnv();
  const baseUrl = env.INTERNAL_API_BASE_URL ?? `http://127.0.0.1:${env.PORT}`;

  const [allChatMessages, existingCompactedContext, memorySummaryText, appTimezone] = await Promise.all([
    loadAllChatMessages(args.db, args.chatId),
    loadExistingCompactedContext(args.db, args.chatId),
    loadMemorySummaryText(args.db, args.walletAddress),
    loadAppTimezone(args.db, args.walletAddress),
  ]);

  const assembled = await assembleContext({
    systemPrompt: "", // see file header — imprecise, token-estimation only
    memorySummary: memorySummaryText,
    existingCompactedContext,
    allChatMessages,
    currentToolResultsText: "", // fresh user message, no in-progress tool round-trip yet
    budget: DEFAULT_CONTEXT_BUDGET,
    compactionDeps: { provider: getProviderForRole("LLM3") },
  });

  // Persist the new compacted-context row if assembleContext just ran compaction — this is
  // exactly the "caller knows to persist an updated chat_compacted_context row" responsibility
  // LLM_CONTRACT.md assigns to apps/api.
  if (assembled.usedCompaction && assembled.newCompactedContext) {
    await args.db.insert(chatCompactedContext).values({
      chatId: args.chatId,
      summary: assembled.newCompactedContext.text,
      coversUpToMessageId: assembled.newCompactedContext.coversUpToMessageId,
    });
  }

  const result = await runConversationTurn({
    userMessage: args.userMessage,
    assembledMessages: assembled.messages,
    memorySummary: memorySummaryText,
    currentDateTimeIso: new Date().toISOString(),
    appTimezone,
    // Same hardcoded-TESTNET convention as every other route module — see API_CONTRACT.md §7.
    environment: "TESTNET",
    deps: {
      provider: getProviderForRole("LLM1"),
      apiClient: new ReferenceApiClient(baseUrl, args.accessToken),
      tavilyClient: createTavilyClient(),
    },
  });

  // token-counter.ts's own doc comment: "log a warning if drift exceeds ~15% so the estimate
  // can be re-tuned over time." See file header for why this is a local reimplementation.
  const drift = estimationDriftRatio(assembled.estimatedInputTokens, result.usage.inputTokens);
  if (Math.abs(drift) > 0.15) {
    // eslint-disable-next-line no-console
    console.warn(
      `[runConversationTurnAdapter] token estimate drifted ${(drift * 100).toFixed(1)}% ` +
        `from actual usage (estimated=${assembled.estimatedInputTokens}, actual=${result.usage.inputTokens})`,
    );
  }

  return {
    assistantMessage: result.assistantText,
    toolCalls: result.toolTrace,
    toolResults: undefined,
    suggestedTitle: undefined,
  };
}