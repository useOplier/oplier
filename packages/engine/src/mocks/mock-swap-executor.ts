import type { SwapExecResult, SwapExecutor, SwapParams, TransactionResult } from "../types.js";

export type ScriptedOutcome =
  /**
   * `amountIn`/`amountOut` are the reconciled on-chain fill amounts (doc 05 §16). Both default
   * to "1" so existing tests keep asserting a cost basis of 1 / quantity of 1, but they now
   * flow through the engine's real reconciliation path rather than the hardcoded "1" the engine
   * itself used to substitute. Set them explicitly to exercise a non-unit fill.
   */
  | { kind: "success"; amountIn?: string; amountOut?: string }
  /** Success receipt with NO reconcilable amounts — exercises the engine's "don't fabricate a
   *  cost basis" branch, where the transaction is still recorded but the position is left alone. */
  | { kind: "success-unreconciled" }
  | { kind: "retryable-failure"; errorLog?: string }
  | { kind: "non-retryable-failure"; errorLog?: string }
  | { kind: "pending" }
  /** Returns PENDING for the first `after` calls against a given txHash, then resolves to `then`. */
  | { kind: "pending-then"; after: number; then: Exclude<ScriptedOutcome, { kind: "pending-then" }> };

let counter = 0;

/**
 * Scriptable swap mock. `queueFor(executionId, outcome)` pushes one scripted outcome
 * consumed by the next `getReceipt` call for a tx this mock produced — lets tests script
 * "first attempt fails retryably, second attempt succeeds" sequences (doc 05 §24, brief
 * responsibility #8). `pending`/`pending-then` support the receipt-polling tests (doc 05 §15).
 */
export class MockSwapExecutor implements SwapExecutor {
  private outcomeQueueByExecutionId = new Map<string, ScriptedOutcome[]>();
  private defaultOutcome: ScriptedOutcome = { kind: "success" };
  private txToExecution = new Map<string, string>();
  private pendingCallCounts = new Map<string, number>();
  submittedParams: SwapParams[] = [];

  queueFor(executionId: string, outcome: ScriptedOutcome): void {
    const q = this.outcomeQueueByExecutionId.get(executionId) ?? [];
    q.push(outcome);
    this.outcomeQueueByExecutionId.set(executionId, q);
  }

  setDefaultOutcome(outcome: ScriptedOutcome): void {
    this.defaultOutcome = outcome;
  }

  async executeSwap(params: SwapParams): Promise<SwapExecResult> {
    this.submittedParams.push(params);
    counter += 1;
    const txHash = `0xmocktx${counter}_${params.executionId}`;
    this.txToExecution.set(txHash, params.executionId);
    return { txHash, status: "SUBMITTED" };
  }

  async getReceipt(txHash: string): Promise<TransactionResult> {
    const executionId = this.txToExecution.get(txHash);
    const queue = executionId ? this.outcomeQueueByExecutionId.get(executionId) : undefined;
    const outcome = queue?.shift() ?? this.defaultOutcome;
    return this.resolve(txHash, outcome);
  }

  private resolve(txHash: string, outcome: ScriptedOutcome): TransactionResult {
    if (outcome.kind === "pending-then") {
      const count = (this.pendingCallCounts.get(txHash) ?? 0) + 1;
      this.pendingCallCounts.set(txHash, count);
      if (count <= outcome.after) {
        return { txHash, status: "PENDING", retryable: null };
      }
      return this.resolve(txHash, outcome.then);
    }
    if (outcome.kind === "success") {
      return {
        txHash,
        status: "SUCCESS",
        retryable: null,
        amountIn: outcome.amountIn ?? "1",
        amountOut: outcome.amountOut ?? "1",
        blockNumber: 1_000_000 + counter,
      };
    }
    if (outcome.kind === "success-unreconciled") {
      return { txHash, status: "SUCCESS", retryable: null };
    }
    if (outcome.kind === "pending") {
      return { txHash, status: "PENDING", retryable: null };
    }
    if (outcome.kind === "retryable-failure") {
      return { txHash, status: "FAILED", retryable: true, errorLog: outcome.errorLog ?? "slippage exceeded" };
    }
    return { txHash, status: "FAILED", retryable: false, errorLog: outcome.errorLog ?? "insufficient allowance" };
  }
}