/**
 * Retryable/non-retryable classification for on-chain revert reasons (post-submission) and
 * submission-layer errors. Per full_specifications.txt §9: "The backend classifies transaction
 * failures as retryable/transient or non-retryable ... The LLM does not determine
 * retryability; the backend execution layer does" — this file is that classification logic
 * for the AMM layer specifically (Part C's own classification for its own halt/resume
 * mechanics sits above this and is authoritative for `retryable` once this returns it, per
 * ENGINE_CONTRACT.md's "never re-derived by this engine").
 *
 * Classification used, with reasoning:
 *  - INSUFFICIENT_LIQUIDITY / INSUFFICIENT_A_AMOUNT / INSUFFICIENT_B_AMOUNT (V2 Router/Pair
 *    revert strings) → NON-retryable. Structural: the pool has no/insufficient reserves right
 *    now and retrying the identical transaction will revert identically until Part K seeds it.
 *  - INSUFFICIENT_OUTPUT_AMOUNT (on-chain slippage breach — pool price moved between our
 *    pre-submission quote and the transaction actually mining) → retryable. Transient/
 *    price-dependent; per spec §9 "retry the same transaction" applies naturally since a later
 *    attempt against a recovered price can succeed with the same params.
 *  - EXPIRED (deadline passed before mining, typically network congestion) → retryable.
 *  - Gas/nonce/RPC-layer errors surfaced by the session-key sender before a receipt exists →
 *    retryable (classic transient failures).
 *  - Anything unrecognized → non-retryable (safe default: halt for manual review rather than
 *    silently retrying an unknown failure mode indefinitely, matching Part C's own default of
 *    halting on anything it can't positively classify as safe to retry).
 */

export interface Classification {
  retryable: boolean;
  reason: string;
}

const NON_RETRYABLE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /INSUFFICIENT_LIQUIDITY/i, reason: "NO_LIQUIDITY" },
  { pattern: /INSUFFICIENT_A_AMOUNT/i, reason: "NO_LIQUIDITY" },
  { pattern: /INSUFFICIENT_B_AMOUNT/i, reason: "NO_LIQUIDITY" },
  { pattern: /TRANSFER_FROM_FAILED/i, reason: "INSUFFICIENT_ALLOWANCE_OR_BALANCE" },
  { pattern: /INSUFFICIENT_INPUT_AMOUNT/i, reason: "INVALID_AMOUNT" },
];

const RETRYABLE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /INSUFFICIENT_OUTPUT_AMOUNT/i, reason: "SLIPPAGE_BREACH" },
  { pattern: /EXPIRED/i, reason: "DEADLINE_EXPIRED" },
  { pattern: /nonce too low/i, reason: "NONCE_CONFLICT" },
  { pattern: /replacement transaction underpriced/i, reason: "GAS_UNDERPRICED" },
  { pattern: /timeout|ETIMEDOUT|ECONNRESET/i, reason: "RPC_TRANSIENT" },
  { pattern: /rate limit/i, reason: "RPC_TRANSIENT" },
];

export function classifyRevertReason(revertReason: string | undefined): Classification {
  const text = revertReason ?? "";
  for (const { pattern, reason } of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(text)) return { retryable: false, reason };
  }
  for (const { pattern, reason } of RETRYABLE_PATTERNS) {
    if (pattern.test(text)) return { retryable: true, reason };
  }
  return { retryable: false, reason: "UNCLASSIFIED_REVERT" };
}

export function classifySubmissionError(error: unknown): Classification {
  const message = error instanceof Error ? error.message : String(error);
  for (const { pattern, reason } of RETRYABLE_PATTERNS) {
    if (pattern.test(message)) return { retryable: true, reason };
  }
  for (const { pattern, reason } of NON_RETRYABLE_PATTERNS) {
    if (pattern.test(message)) return { retryable: false, reason };
  }
  return { retryable: false, reason: "UNCLASSIFIED_SUBMISSION_ERROR" };
}
