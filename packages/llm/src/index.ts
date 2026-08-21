// packages/llm/src/index.ts — public surface of the package.

export * from "./types";
export { getProviderForRole } from "./providers/factory";
export { llm1Tools } from "./tools/tool-definitions";
export { runConversationTurn } from "./services/conversation.service";
export type { RunConversationTurnInput, RunConversationTurnOutput } from "./services/conversation.service";
export { updateMemory, parseMemoryOutput } from "./services/memory.service";
export type { UpdateMemoryInput, UpdateMemoryOutput } from "./services/memory.service";
export { compactChat } from "./services/compaction.service";
export type { CompactionInput, CompactionOutput } from "./services/compaction.service";
export { assembleContext } from "./context/assemble-context";
export type { AssembleContextParams, AssembleContextResult, ChatMessageRecord } from "./context/assemble-context";
export { estimateTokens, availableInputBudget } from "./context/token-counter";
export type { ApiClient, ApiError } from "./services/api-client";
export { ReferenceApiClient } from "./services/api-client";
export type { TavilyClient, TavilySearchResult } from "./services/tavily-client";
export { RealTavilyClient } from "./services/tavily-client";
