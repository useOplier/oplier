/**
 * Mirrors LLM_CONTRACT.md's `ChatMessage` shape and the three service
 * function outputs. LLM_CONTRACT.md documents `runConversationTurn` as a
 * package-level function Part G exposes to `apps/api` — it does not itself
 * define the REST shape `apps/api` puts in front of it, and API_CONTRACT.md's
 * endpoint table (§3) has no `/chats` route at all.
 *
 * FLAGGED ASSUMPTION (mirrors the docs' own convention of flagging rather
 * than silently inventing, e.g. LLM_CONTRACT.md §4's `prepare_transaction`):
 * the `/chats` endpoints below are Part H's best guess at what `apps/api`
 * needs to expose to make doc 02's chat flow reachable from a browser. They
 * are not in API_CONTRACT.md and need confirmation from Part B before this
 * stops being mocked.
 */

export type ChatRole = "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Present when the assistant's turn produced a one-off transaction to confirm (doc 02). */
  pendingTransaction?: PendingTransactionCard | null;
  /** Present when the assistant's turn produced a UPM ready for user review (doc 02 creation step 5). */
  pendingSystem?: PendingSystemCard | null;
}

export interface PendingTransactionCard {
  transactionId: string;
  fromAsset: string;
  toAsset: string;
  amount: number;
  amountAsset: string;
  estimatedReceiveAmount: number;
  estimatedPriceUsd: number;
  maxSlippagePercent: number;
  status: "AWAITING_APPROVAL" | "APPROVED" | "CANCELLED" | "SUBMITTED" | "SUCCESS" | "FAILED";
  txHash?: string | null;
}

export interface PendingSystemCard {
  draftSystemId: string;
  name: string;
  summary: string; // human-readable structured description, not raw JSON
  maxAllocation: number;
  maxAllocationAsset: string;
  status: "AWAITING_ACTIVATION" | "ACTIVATED" | "DISMISSED";
}

export interface ChatSummary {
  id: string;
  title: string; // generated per doc 02 "Generated chat titles"
  updatedAt: string;
}

export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
}
