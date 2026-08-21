/**
 * Step execution (brief responsibilities #4, #5, #7, #8).
 *
 * - Duplicate-execution protection: identity is (systemId, runId, stepId). The atomic
 *   check-and-create is `repository.createExecutionIfAbsent`, which a real Drizzle adapter
 *   implements as a single INSERT relying on the DB-level unique constraint
 *   `executions_system_run_step_unique` (full_schema.txt) to fail/no-op on collision — see
 *   `repository/drizzle-adapter.ts`. This module never does a separate SELECT-then-INSERT;
 *   the repository call itself IS the lock (brief: "must be safe under concurrent
 *   workers/retries").
 * - Step lock: WAITING (row just created) -> EXECUTING (attempt in flight, held for every
 *   retry of "the same transaction" per doc 05 §24) -> COMPLETED (final success).
 * - `execution_limit`: `systems.executionLimit` caps `executions.attemptCount` for THIS row
 *   only (API_CONTRACT.md §6, locked reading) — halt the System once attemptCount would
 *   exceed it, not before the attempt that hits it.
 * - Failure classification: `SwapExecutor.getReceipt`'s `retryable` flag is authoritative;
 *   this module never re-derives it. retryable=true -> increment attemptCount, stay
 *   EXECUTING, remain eligible for another attempt next cycle (unless limit now reached).
 *   retryable=false -> halt the whole System immediately, regardless of attemptCount.
 * - Receipt polling (manager-confirmed, built here rather than deferred to Part I): doc 05
 *   §15 describes a real intermediate PENDING state ("Submit transaction -> txHash -> PENDING
 *   -> wait for receipt -> SUCCESS/FAILED"). `pollForReceipt` re-polls `getReceipt` on an
 *   interval while it stays PENDING, up to `ReceiptPollConfig.maxWaitMs`. A timeout is
 *   surfaced as its own `pending-timeout-halted` outcome — never silently folded into
 *   FAILED, since a still-pending transaction hasn't reverted or been rejected; it's
 *   genuinely unresolved and needs a human to look at chain state before anything
 *   automatically resubmits.
 */

import type { EvaluationContext } from "./condition-evaluator.js";
import type { SystemRepository } from "./repository/types.js";
import { SWAP_DEADLINE_SECONDS } from "./types.js";
import type {
  ExecutionRecord,
  PermissionService,
  SwapExecutor,
  SwapRecord,
  SystemRecord,
  SystemRunRecord,
  SystemStepRecord,
  TransactionResult,
} from "./types.js";

export type StepAttemptOutcome =
  | { kind: "already-completed" }
  | { kind: "attempt-in-progress-elsewhere" }
  | { kind: "no-active-permission-halted" }
  | { kind: "limit-reached-halted" }
  | { kind: "succeeded"; execution: ExecutionRecord; receipt: TransactionResult }
  | { kind: "failed-retryable"; execution: ExecutionRecord }
  | { kind: "failed-non-retryable-halted"; execution: ExecutionRecord }
  | { kind: "pending-timeout-halted"; execution: ExecutionRecord };

export interface StepExecutorDeps {
  repository: SystemRepository;
  swapExecutor: SwapExecutor;
  permissionService: PermissionService;
}

export interface ReceiptPollConfig {
  /** Delay between successive `getReceipt` calls while the receipt stays PENDING. */
  pollIntervalMs: number;
  /**
   * Total time to keep polling before surfacing a `pending-timeout-halted` outcome. No
   * product doc specified a number — flagging these as engine-level defaults, not a
   * confirmed product decision, same footing as the monitoring-cadence numbers in
   * `engine-loop.ts`. 45s covers a typical confirmed-in-a-few-blocks case on an L2 with
   * margin for one retry-worthy delay; tune via the constructor param on `UpmEngine`, not by
   * editing this default in place.
   */
  maxWaitMs: number;
}

export const DEFAULT_RECEIPT_POLL_CONFIG: ReceiptPollConfig = {
  pollIntervalMs: 3000,
  maxWaitMs: 45000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PollResult = { timedOut: false; receipt: TransactionResult } | { timedOut: true };

/**
 * Polls `getReceipt` until it resolves away from PENDING or `maxWaitMs` elapses. The first
 * check happens immediately (no up-front sleep) since the transaction may already have
 * confirmed by the time this is called.
 */
async function pollForReceipt(swapExecutor: SwapExecutor, txHash: string, config: ReceiptPollConfig): Promise<PollResult> {
  const start = Date.now();
  let receipt = await swapExecutor.getReceipt(txHash);
  while (receipt.status === "PENDING") {
    if (Date.now() - start >= config.maxWaitMs) {
      return { timedOut: true };
    }
    await sleep(config.pollIntervalMs);
    receipt = await swapExecutor.getReceipt(txHash);
  }
  return { timedOut: false, receipt };
}

/** Shared classification, used both by a first attempt and by `recheckPendingExecution`'s resume-time re-poll. */
async function applyReceiptOutcome(
  repository: SystemRepository,
  system: SystemRecord,
  run: SystemRunRecord,
  execution: ExecutionRecord,
  receipt: TransactionResult,
  nextAttemptCount: number,
): Promise<StepAttemptOutcome> {
  if (receipt.status === "SUCCESS") {
    const finalExecution = await repository.updateExecution(execution.id, {
      state: "COMPLETED",
      txHash: receipt.txHash,
      status: "SUCCESS",
      attemptCount: nextAttemptCount,
      retryable: null,
      errorLog: null,
    });
    // The receipt travels back with the outcome so `engine.ts`'s `onStepSucceeded` can write the
    // ACTUAL on-chain amountIn/amountOut into positions/transactions (doc 05 §16) instead of the
    // hardcoded "1" it used before. Deliberately passed rather than re-fetched: `getReceipt` may
    // be a live RPC call, and a second read could observe different state than the one this
    // classification was made against.
    return { kind: "succeeded", execution: finalExecution, receipt };
  }

  if (receipt.retryable) {
    // Back to WAITING, not left at EXECUTING: doc 05 §19's WAITING -> EXECUTING -> COMPLETED
    // cycle only has room for EXECUTING to mean "an attempt is actively in flight right now"
    // (that's what makes it usable as the concurrency lock in `attemptStep`:
    // `!created && execution.state === "EXECUTING"`). A retryable failure ends that attempt,
    // so the row goes back to WAITING — eligible for the next retry attempt on a later tick.
    const updated = await repository.updateExecution(execution.id, {
      state: "WAITING",
      txHash: receipt.txHash,
      status: "FAILED",
      attemptCount: nextAttemptCount,
      retryable: true,
      errorLog: receipt.errorLog ?? null,
    });
    if (updated.attemptCount >= system.executionLimit) {
      await haltSystemAndRun(repository, system.id, run.id);
      return { kind: "limit-reached-halted" };
    }
    return { kind: "failed-retryable", execution: updated };
  }

  const updated = await repository.updateExecution(execution.id, {
    state: "WAITING",
    txHash: receipt.txHash,
    status: "FAILED",
    attemptCount: nextAttemptCount,
    retryable: false,
    errorLog: receipt.errorLog ?? null,
  });
  await haltSystemAndRun(repository, system.id, run.id);
  return { kind: "failed-non-retryable-halted", execution: updated };
}

/**
 * Called once a step's condition group has just transitioned FALSE -> TRUE (or, on a retry
 * cycle, an existing not-yet-COMPLETED execution is due for another attempt). Encapsulates
 * the full lock/attempt/poll/classify sequence for a single evaluation tick.
 */
export async function attemptStep(
  deps: StepExecutorDeps,
  system: SystemRecord,
  run: SystemRunRecord,
  step: SystemStepRecord,
  swap: SwapRecord,
  pollConfig: ReceiptPollConfig = DEFAULT_RECEIPT_POLL_CONFIG,
): Promise<StepAttemptOutcome> {
  const { repository, swapExecutor } = deps;

  const created = await repository.createExecutionIfAbsent(system.id, run.id, step.id);
  const execution = created ?? (await repository.getExecutionForStep(run.id, step.id));
  if (!execution) {
    throw new Error("createExecutionIfAbsent returned null but no existing execution was found — repository bug");
  }

  if (execution.state === "COMPLETED") {
    return { kind: "already-completed" };
  }

  if (!created && execution.state === "EXECUTING") {
    // Someone else (or a prior tick of this same worker's earlier iteration) already holds
    // the lock and is mid-attempt. Don't submit a second transaction — this is exactly the
    // race doc 05 §20 is guarding against.
    return { kind: "attempt-in-progress-elsewhere" };
  }

  if (execution.attemptCount >= system.executionLimit) {
    await haltSystemAndRun(repository, system.id, run.id);
    return { kind: "limit-reached-halted" };
  }

  // Authorization gate (Part I). `SwapParams.permissionRef` is what authorizes the swap through
  // Part E's Smart Session, read non-destructively via the port's `getActivePermission`. A
  // System with no live permission must not attempt a submission at all — doc 02 (locked) is
  // explicit that invalid/failed authorization blocks execution and requires manual
  // reauthorization rather than auto-expanding or retrying, so this halts instead of returning a
  // retryable failure. This is also the engine-side half of the defense-in-depth story described
  // in `@oplier/permissions`' `checkBeforeExecution`: a revoked permission stops execution in
  // software even if the on-chain session key somehow outlives it.
  const activePermission = await repository.getActivePermission(system.id);
  if (!activePermission?.sessionReference) {
    await repository.updateExecution(execution.id, {
      state: "WAITING",
      status: "FAILED",
      retryable: false,
      errorLog:
        "No active Smart Session permission for this System — execution blocked pending reauthorization (doc 02).",
    });
    await haltSystemAndRun(repository, system.id, run.id);
    return { kind: "no-active-permission-halted" };
  }

  // Acquire/re-acquire the lock for this attempt — as a COMPARE-AND-SWAP, not a blind write.
  //
  // The `!created && state === "EXECUTING"` check above is necessary but NOT sufficient on its own:
  // it reads the state, and this claim writes it, so two ticks could both read 'WAITING', both pass
  // that check, and both submit. That is not hypothetical — it produced two on-chain swaps for one
  // (system, run, step) with `attempt_count` stuck at 1. `claimExecutionForAttempt` collapses the
  // read and the write into one statement, so exactly one caller proceeds.
  const claimed = await repository.claimExecutionForAttempt(execution.id);
  if (!claimed) {
    // Lost the race to a concurrent tick that is already mid-attempt. Same outcome as the guard
    // above — defer, and never submit a second transaction.
    return { kind: "attempt-in-progress-elsewhere" };
  }

  /**
   * `executeSwap` THROWS on a rejected submission (a bundler `RpcRequestError`, an RPC timeout), and
   * that throw must not escape while the lock is held.
   *
   * THE BUG THIS FIXES: the lock above is set before submission, so an uncaught throw here left the
   * row at `state = 'EXECUTING'` with `tx_hash = NULL` and `attempt_count` still 0 — permanently.
   * Every later tick then matched the `!created && state === "EXECUTING"` branch above and returned
   * `attempt-in-progress-elsewhere`, deferring to an attempt that had already died. The System stayed
   * ACTIVE and silently never executed again; only a process restart (whose
   * `recoverAbandonedExecutionLocks` releases `EXECUTING` + `tx_hash IS NULL`) could free it.
   * Observed live: a bundler gas rejection wedged the System and every subsequent tick no-op'd.
   *
   * Releasing to WAITING is safe for exactly the reason the recovery query relies on: the throw came
   * from the submit call itself, so no txHash exists and no transaction can be in flight. It is
   * reported as `failed-retryable` because the cause is often transient (RPC timeout, a bundler that
   * momentarily rejects) — and critically, `attemptCount` IS incremented, so the `executionLimit`
   * check above bounds the retries instead of letting a deterministic failure spin forever.
   */
  let submitted: Awaited<ReturnType<typeof swapExecutor.executeSwap>>;
  try {
    submitted = await swapExecutor.executeSwap({
      sourceAsset: swap.sourceAsset,
      destinationAsset: swap.destinationAsset,
      amountType: swap.amountType,
      amountValue: swap.amountValue,
      maxSlippageBps: swap.maxSlippageBps,
      walletAddress: system.walletAddress,
      systemId: system.id,
      executionId: execution.id,
      runId: run.id,
      permissionRef: activePermission.sessionReference,
      deadline: new Date(Date.now() + SWAP_DEADLINE_SECONDS * 1000),
    });
  } catch (err) {
    const updated = await repository.updateExecution(execution.id, {
      state: "WAITING",
      status: "FAILED",
      attemptCount: execution.attemptCount + 1,
      retryable: true,
      errorLog: `Submission failed before any transaction was sent: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    return { kind: "failed-retryable", execution: updated };
  }

  const nextAttemptCount = execution.attemptCount + 1;
  const polled = await pollForReceipt(swapExecutor, submitted.txHash, pollConfig);

  if (polled.timedOut) {
    // Keep state EXECUTING (not WAITING): this is deliberately NOT treated like a retryable
    // failure. Leaving it at EXECUTING means it still holds the concurrency lock, so nothing
    // automatically resubmits a second transaction against a tx that might still land later.
    // Combined with the System-level HALTED status (below), no further ticks touch this step
    // until a human resumes it — and `UpmEngine.resumeSystem` re-polls this exact txHash
    // before deciding what to do next, rather than blindly resetting and resubmitting.
    const updated = await repository.updateExecution(execution.id, {
      state: "EXECUTING",
      txHash: submitted.txHash,
      status: "PENDING",
      attemptCount: nextAttemptCount,
      retryable: null,
      errorLog: `Transaction still PENDING after ${pollConfig.maxWaitMs}ms — needs manual review`,
    });
    await haltSystemAndRun(repository, system.id, run.id);
    return { kind: "pending-timeout-halted", execution: updated };
  }

  return applyReceiptOutcome(repository, system, run, execution, polled.receipt, nextAttemptCount);
}

/**
 * Resume-time recheck for a System halted by `pending-timeout-halted`. Re-polls the SAME
 * txHash (never resubmits a new transaction — see `attemptStep`'s comment on why EXECUTING
 * is held through a timeout) for up to another `pollConfig` window. If it resolves, applies
 * the normal SUCCESS/retryable/non-retryable classification. If it's still PENDING at the
 * end of this window too, halts again with a fresh `pending-timeout-halted` outcome —
 * `attemptCount` is intentionally left unchanged, since re-checking an existing transaction's
 * status isn't a new attempt against `executionLimit`.
 */
export async function recheckPendingExecution(
  deps: StepExecutorDeps,
  system: SystemRecord,
  run: SystemRunRecord,
  execution: ExecutionRecord,
  pollConfig: ReceiptPollConfig = DEFAULT_RECEIPT_POLL_CONFIG,
): Promise<StepAttemptOutcome> {
  const { repository, swapExecutor } = deps;
  if (!execution.txHash) {
    throw new Error("recheckPendingExecution called on an execution with no txHash to poll");
  }

  const polled = await pollForReceipt(swapExecutor, execution.txHash, pollConfig);
  const nextAttemptCount = execution.attemptCount; // re-checking isn't a new attempt

  if (polled.timedOut) {
    const updated = await repository.updateExecution(execution.id, {
      state: "EXECUTING",
      status: "PENDING",
      retryable: null,
      errorLog: `Transaction still PENDING after ${pollConfig.maxWaitMs}ms on recheck — needs manual review`,
    });
    await haltSystemAndRun(repository, system.id, run.id);
    return { kind: "pending-timeout-halted", execution: updated };
  }

  return applyReceiptOutcome(repository, system, run, execution, polled.receipt, nextAttemptCount);
}

async function haltSystemAndRun(repository: SystemRepository, systemId: string, runId: string): Promise<void> {
  await repository.updateSystemStatus(systemId, "HALTED");
  await repository.updateRunStatus(runId, "HALTED");
}

/** Re-export for callers that only need the evaluation-context shape alongside step execution. */
export type { EvaluationContext };