/**
 * Repository port.
 *
 * ARCHITECTURE NOTE (flagging this — it's not something the brief asked for explicitly):
 * the brief says the engine uses `packages/db` "for all state." This file defines a thin
 * repository *interface* the engine's business logic depends on, with a real Drizzle-backed
 * implementation (`repository/drizzle-adapter.ts`) as a reference/production adapter, rather
 * than having `state-machine.ts` / `condition-evaluator.ts` / etc. import `@oplier/db` and
 * call `db.select()...` directly inline.
 *
 * Why: this sandbox has no live Postgres/Supabase connection, so the only way to actually
 * *run* the required test suite (system creation → activation → trigger → swap → next step
 * → completion, halt/resume, pause/resume, expiration, reactivation, modification,
 * duplicate-execution race) is against something in-memory. A repository seam makes that
 * possible without faking Drizzle's query builder. It also directly satisfies the brief's
 * deliverable #2 requirement ("an internal but well-documented execution/condition-evaluation
 * module other engineers ... can wire the real ... implementations into without touching the
 * state machine logic") — the seam IS that wiring point for persistence, same idea already
 * applied to Price/Permission/Swap.
 *
 * `repository/drizzle-adapter.ts` shows the exact mapping onto the real `packages/db` schema
 * (full_schema.txt) so Part I doesn't have to guess field names or FK behavior when swapping
 * the in-memory adapter for the real one. It is not exercised by the test suite here (no DB
 * available in this environment) — Part I's first job on this file should be running it
 * against a real Supabase instance before trusting it, same caveat Part B raised for its own
 * work in API_CONTRACT.md §0.
 *
 * If the manager thread would rather Part C import `@oplier/db` directly and skip this seam,
 * that's a one-file change (delete this interface, point the four modules at Drizzle calls
 * copied out of `drizzle-adapter.ts`) — flagging so it's a conscious call, not a silent one.
 */

import type {
  ConditionRecord,
  ExecutionRecord,
  PositionRecord,
  SwapRecord,
  SystemRecord,
  SystemRunRecord,
  SystemStepRecord,
  TransactionRecord,
} from "../types.js";

export interface StepBundle {
  step: SystemStepRecord;
  conditions: ConditionRecord[];
  swap: SwapRecord;
}

export interface SystemRepository {
  // --- settings (doc 02 "Timezone": one universal, per-user, app timezone; Systems use it —
  // needed for TIME condition evaluation. Not one of the brief's 3 mocked interfaces since
  // `settings` is plain first-party DB state Part A/B already own, not an external system to
  // stub out; reading it through this same repository seam avoids inventing a 4th provider
  // interface for something that isn't external.) ---
  getUserTimezone(walletAddress: string): Promise<string>; // defaults "UTC" if unset

  // --- systems ---
  getSystem(systemId: string): Promise<SystemRecord | null>;
  createSystemWithSteps(
    system: Omit<SystemRecord, "id" | "currentRunId">,
    steps: Array<{
      groupOperator: SystemStepRecord["groupOperator"];
      conditions: Array<Pick<ConditionRecord, "conditionType" | "parameters">>;
      swap: Omit<SwapRecord, "id" | "stepId">;
    }>,
  ): Promise<{ system: SystemRecord; steps: StepBundle[] }>;
  updateSystemStatus(systemId: string, status: SystemRecord["status"]): Promise<SystemRecord>;
  updateSystemCurrentRun(systemId: string, runId: string | null): Promise<SystemRecord>;
  patchSystem(
    systemId: string,
    patch: Partial<
      Pick<SystemRecord, "name" | "maxAllocation" | "maxAllocationAsset" | "executionLimit" | "expiresAt">
    >,
  ): Promise<SystemRecord>;
  deleteSystem(systemId: string): Promise<void>; // cascades steps/conditions/swaps, SET NULLs the rest — see full_schema.txt §8a
  listActiveSystems(): Promise<SystemRecord[]>;

  // --- steps / conditions / swaps ---
  getStepBundle(stepId: string): Promise<StepBundle | null>;
  listStepsForSystem(systemId: string): Promise<StepBundle[]>;
  replaceStepConditions(
    stepId: string,
    conditions: Array<Pick<ConditionRecord, "conditionType" | "parameters">>,
  ): Promise<ConditionRecord[]>;
  replaceStepSwap(stepId: string, swap: Omit<SwapRecord, "id" | "stepId">): Promise<SwapRecord>;
  updateConditionState(conditionId: string, currentState: boolean): Promise<void>;
  resetAllConditionStatesForSystem(systemId: string): Promise<void>; // doc 05 §22 on reactivation

  // --- runs ---
  createRun(systemId: string, runNumber: number): Promise<SystemRunRecord>;
  getRun(runId: string): Promise<SystemRunRecord | null>;
  getCurrentRun(systemId: string): Promise<SystemRunRecord | null>;
  updateRunStatus(runId: string, status: SystemRunRecord["status"]): Promise<SystemRunRecord>;
  updateRunCurrentStep(runId: string, stepId: string | null): Promise<SystemRunRecord>;
  countRunsForSystem(systemId: string): Promise<number>;

  // --- executions (duplicate-protection + step lock) ---
  /**
   * Atomic check-and-create keyed on (systemId, runId, stepId). Must return `null` — never
   * throw — when a row already exists for that triple, so callers can treat "already exists"
   * as a normal, expected outcome of the race rather than an exceptional one (doc 05 §20).
   */
  createExecutionIfAbsent(systemId: string, runId: string, stepId: string): Promise<ExecutionRecord | null>;
  /**
   * Compare-and-swap claim of an EXISTING execution row's step lock. Flips `state` to `'EXECUTING'`
   * ONLY if it is not already `'EXECUTING'`, and returns whether this caller won the claim.
   *
   * THE BUG THIS EXISTS TO CLOSE: `createExecutionIfAbsent` is atomic for *creating* a row, but
   * re-claiming an existing one used to be a plain unconditional `updateExecution({ state })`. Two
   * ticks that both read `state = 'WAITING'` both passed the "is it EXECUTING?" guard and both
   * submitted, so ONE (systemId, runId, stepId) produced TWO real on-chain swaps while
   * `attempt_count` stayed at 1 — observed live: two USDG left the account for one logical execution.
   * That directly violates doc 05 §20 ("a completed execution cannot create another transaction
   * during the same run"), which the surrounding code claims to enforce.
   *
   * Implementations MUST do the read and the write in one statement (`UPDATE ... WHERE id = ? AND
   * state <> 'EXECUTING' RETURNING ...`). Returning `false` means someone else holds the lock.
   */
  claimExecutionForAttempt(executionId: string): Promise<boolean>;
  getExecution(executionId: string): Promise<ExecutionRecord | null>;
  getExecutionForStep(runId: string, stepId: string): Promise<ExecutionRecord | null>;
  updateExecution(
    executionId: string,
    patch: Partial<
      Pick<ExecutionRecord, "state" | "txHash" | "status" | "retryable" | "errorLog" | "attemptCount">
    >,
  ): Promise<ExecutionRecord>;

  // --- positions (doc 04 §7 weighted-average cost basis) ---
  getPosition(systemId: string, assetId: string): Promise<PositionRecord | null>;
  /**
   * Applies one reconciled fill to the System's position for `assetId`, accumulating
   * weighted-average cost basis (doc 04 §7) and flipping CLOSED -> OPEN on any fill.
   *
   * `filledQuantity` / `filledCostInQuoteAsset` MUST be the actual on-chain amounts taken from
   * the transaction receipt (doc 05 §16: "Internal state must reflect actual on-chain execution
   * rather than merely the original quote"), in the asset's human-decimal units. They were
   * previously hardcoded to `"1"` at the call site in `engine.ts` because the mock swap executor
   * returned no fill data — that made every cost basis fabricated, which in turn made every ROI
   * condition evaluate against garbage. Real amounts are now threaded through from the receipt;
   * a fill whose amounts can't be reconciled is recorded without touching cost basis rather than
   * with an invented number (see `onStepSucceeded`).
   */
  upsertPositionOnFill(input: {
    walletAddress: string;
    systemId: string;
    assetId: string;
    filledQuantity: string;
    filledCostInQuoteAsset: string;
  }): Promise<PositionRecord>;
  closePositionsForSystem(systemId: string): Promise<void>;
  reopenPositionsForSystem(systemId: string): Promise<void>;

  // --- transactions (Activity screen backing) ---
  recordTransaction(tx: Omit<TransactionRecord, "id">): Promise<TransactionRecord>;

  // --- permissions bookkeeping (nexus_permissions table; actual on-chain calls are Part E's) ---
  recordPermissionCreated(systemId: string, ref: { id: string; sessionReference: string | null; scope: unknown }): Promise<void>;
  /**
   * ADDED (Part I): non-destructive read of the System's current active permission — the most
   * recent non-REVOKED `nexus_permissions` row, or null if none exists / all are revoked.
   *
   * Why this had to exist: `SwapParams.permissionRef` is how a swap is authorized, but the only
   * accessor on this port was `revokeActivePermission`, which *mutates* (it flips the row to
   * REVOKED and returns it). There was no way to read the active permission without destroying
   * it. The alternative — having `apps/worker` read `NexusPermissionRepository.findCurrentForSystem`
   * from `@oplier/permissions` directly — was rejected deliberately: it would reach around this
   * seam and reintroduce exactly the persistence coupling the seam exists to prevent.
   */
  getActivePermission(systemId: string): Promise<{ id: string; sessionReference: string | null } | null>;
  revokeActivePermission(systemId: string): Promise<{ id: string; sessionReference: string | null } | null>;
}
