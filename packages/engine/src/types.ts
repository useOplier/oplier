/**
 * Part C — UPM Execution Engine — core types.
 *
 * Enum values are copied verbatim from `packages/db/src/enums.ts` (Part A/B's real schema,
 * see full_schema.txt) so this module never drifts from what's actually persisted.
 */

// ---------------------------------------------------------------------------
// Enums (verbatim from packages/db/src/enums.ts)
// ---------------------------------------------------------------------------

export const SYSTEM_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "HALTED",
  "EXPIRED",
  "COMPLETE",
  // Persisted but not yet authorized on-chain. The engine never sets this and never executes a
  // System in it — the API writes it and the worker's activation reconciler clears it — but it must
  // exist here or reading such a row back through `mapSystem` fails its own type.
  "AUTHORIZATION_REQUIRED",
] as const;
export type SystemStatus = (typeof SYSTEM_STATUSES)[number];

/** No PAUSED run state — pausing is tracked on `systems.status` only (schema comment, enums.ts). */
export const RUN_STATUSES = ["ACTIVE", "HALTED", "EXPIRED", "COMPLETE"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const CONDITION_TYPES = [
  "PRICE_VALUE",
  "PRICE_PERCENT",
  "ROI",
  "TIME",
  "HIGH_IMPACT_NEWS",
] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

export const GROUP_OPERATORS = ["AND", "OR"] as const;
export type GroupOperator = (typeof GROUP_OPERATORS)[number];

export const AMOUNT_TYPES = [
  "FIXED",
  "CURRENT_BALANCE_PERCENT",
  "SYSTEM_START_BALANCE_PERCENT",
] as const;
export type AmountType = (typeof AMOUNT_TYPES)[number];

export const EXECUTION_STATES = ["WAITING", "EXECUTING", "COMPLETED"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const TX_STATUSES = ["PENDING", "SUCCESS", "FAILED"] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

// ---------------------------------------------------------------------------
// Condition parameter shapes (verbatim from API_CONTRACT.md §6 / packages/shared-types)
// ---------------------------------------------------------------------------

export interface PriceValueParams {
  asset: string;
  operator: "EQ" | "GT" | "LT";
  value: number;
}

export interface PricePercentOrRoiParams {
  asset: string;
  direction: "UP" | "DOWN";
  percent: number;
}

export interface TimeParams {
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
}

export interface HighImpactNewsParams {
  withinHours: 1 | 24;
}

export type ConditionParameters =
  | PriceValueParams
  | PricePercentOrRoiParams
  | TimeParams
  | HighImpactNewsParams;

// ---------------------------------------------------------------------------
// Domain records — shaped to match packages/db tables, not 1:1 Drizzle row types,
// so this package has no compile-time dependency on packages/db (see README §"Why
// no packages/db import").
// ---------------------------------------------------------------------------

export interface SystemRecord {
  id: string;
  walletAddress: string;
  name: string;
  status: SystemStatus;
  maxAllocation: string; // numeric(38,18) as string, per Drizzle's default numeric mode
  maxAllocationAsset: string;
  expiresAt: string | null; // ISO
  executionLimit: number;
  currentRunId: string | null;
}

export interface SystemRunRecord {
  id: string;
  systemId: string | null;
  runNumber: number;
  status: RunStatus;
  currentStepId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface SystemStepRecord {
  id: string;
  systemId: string;
  stepOrder: number;
  groupOperator: GroupOperator;
}

export interface ConditionRecord {
  id: string;
  stepId: string;
  conditionType: ConditionType;
  parameters: ConditionParameters;
  currentState: boolean;
}

export interface SwapRecord {
  id: string;
  stepId: string;
  sourceAsset: string;
  destinationAsset: string;
  amountType: AmountType;
  amountValue: string; // numeric as string
  executionOrder: number;
  maxSlippageBps: number;
}

export interface ExecutionRecord {
  id: string;
  systemId: string | null;
  runId: string;
  stepId: string | null;
  state: ExecutionState;
  txHash: string | null;
  status: TxStatus | null;
  retryable: boolean | null;
  errorLog: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PositionRecord {
  id: string;
  walletAddress: string;
  systemId: string | null;
  assetId: string;
  status: "OPEN" | "CLOSED";
  costBasis: string;
  quantity: string;
  currentValue: string;
  openedAt: string;
  closedAt: string | null;
}

export interface TransactionRecord {
  id: string;
  walletAddress: string;
  source: "SYSTEM" | "ONE_OFF";
  executionId: string | null;
  systemId: string | null;
  txHash: string | null;
  status: TxStatus;
  sourceAsset: string;
  destinationAsset: string;
  amountIn: string | null;
  amountOut: string | null;
  /** `transactions.block_number` — present once the receipt is reconciled (doc 05 §16). */
  blockNumber: number | null;
}

// ---------------------------------------------------------------------------
// SystemSpec — the shape LLM #1 / the API layer hands the engine on create/modify.
// Mirrors `packages/shared-types`' SystemSpec (API_CONTRACT.md §8) at the fields
// this engine actually needs; the real type is the source of truth.
// ---------------------------------------------------------------------------

export interface ConditionSpec {
  conditionType: ConditionType;
  parameters: ConditionParameters;
}

export interface SwapSpec {
  sourceAsset: string;
  destinationAsset: string;
  amountType: AmountType;
  amountValue: number;
  maxSlippageBps?: number;
}

export interface SystemStepSpec {
  groupOperator: GroupOperator;
  conditions: ConditionSpec[];
  swap: SwapSpec;
}

export interface SystemSpec {
  name: string;
  maxAllocation: number;
  maxAllocationAsset: string;
  expiresAt?: string | null;
  executionLimit: number;
  steps: SystemStepSpec[];
}

export type SystemSpecPatch = Partial<
  Pick<SystemSpec, "name" | "maxAllocation" | "maxAllocationAsset" | "executionLimit"> & {
    expiresAt: string | null;
  }
>;

/**
 * Modification of steps/conditions/swaps (API_CONTRACT.md §3 PATCH /systems/:id note:
 * "changing steps/conditions/swaps ... is a Part C/E concern"). Targets exactly one
 * step's condition group and/or swap, per doc 05 §30 ("changes only the specified
 * condition/swap").
 */
export interface StepModification {
  stepId: string;
  conditions?: ConditionSpec[];
  swap?: SwapSpec;
}

// ---------------------------------------------------------------------------
// Consumed interfaces — mocked in this deliverable, real implementations land in
// Parts D (price), E (permission), F (swap). See ENGINE_CONTRACT.md.
// ---------------------------------------------------------------------------

export interface PriceSnapshot {
  price: number;
  timestamp: number; // unix ms
  isStale: boolean;
}

export interface PriceDataProvider {
  getCurrentPrice(assetId: string): Promise<PriceSnapshot>;
}

export interface PermissionScope {
  systemId: string;
  walletAddress: string;
  maxAllocation: string;
  maxAllocationAsset: string;
  assets: string[];
  /**
   * ADDED (Part I): the System's own `expiresAt`, threaded through so the permission layer can
   * set a real on-chain time bound. Previously absent, which meant every permission was created
   * with no `validUntil` at all — flagged by both `packages/permissions`' types.ts ("Doc 02 wants
   * 'time bounds' as one of the scoping dimensions; right now the engine adapter creates
   * permissions with no explicit validUntil") and its FINDINGS.md addendum. `null` = the System
   * has no expiration, in which case the permission layer applies its own long-lived default
   * rather than an unbounded session (see `DEFAULT_PERMISSION_LIFETIME_SECONDS` there) — a UPM
   * is expected to run autonomously for its real intended lifetime, so a short default would
   * silently kill long-running Systems.
   */
  expiresAt: string | null;
}

export interface PermissionRef {
  id: string;
  sessionReference: string | null;
}

export interface PermissionService {
  createPermission(scope: PermissionScope): Promise<PermissionRef>;
  revokePermission(permissionRef: PermissionRef): Promise<void>;
}

export interface SwapParams {
  sourceAsset: string;
  destinationAsset: string;
  amountType: AmountType;
  amountValue: string;
  maxSlippageBps: number;
  walletAddress: string;
  systemId: string;
  executionId: string;
  /**
   * ADDED (Part I): all three fields below were required by `@oplier/amm-execution`'s
   * `SwapParams` but absent here, which made `AmmSwapExecutor` structurally unassignable to
   * `SwapExecutor` — a hard `tsc` error (TS2322: "Type 'SwapParams' is missing the following
   * properties: runId, permissionRef, deadline"), not a stylistic difference.
   *
   * `runId` scopes SYSTEM_START_BALANCE_PERCENT's balance snapshot to the current run. It was
   * always available at the call site (`step-executor.ts`'s `run.id`) and simply wasn't passed.
   */
  runId: string;
  /**
   * The active Smart Session permission this swap executes under. Read through the repository
   * port's `getActivePermission` (added for exactly this — the port previously had no
   * non-destructive way to read it; `revokeActivePermission` was the only accessor and it
   * mutates).
   *
   * Non-nullable on purpose: `step-executor.ts` halts the System *before* calling the executor
   * when no live permission exists (doc 02 — invalid authorization blocks execution), so a null
   * can never reach here. Typing it `string | null` would push a runtime hazard into
   * `@oplier/amm-execution`, whose own `SwapParams` requires a plain `string`.
   */
  permissionRef: string;
  /** V2 router `deadline`. See `SWAP_DEADLINE_SECONDS` below for the policy and why it's short. */
  deadline: Date;
}

export interface SwapExecResult {
  txHash: string;
  status: "PENDING" | "SUBMITTED";
}

/**
 * Swap deadline policy (Part I, manager-confirmed): a fixed, short window from submission.
 *
 * Documented as a named constant rather than inlined at the call site so it's tunable in one
 * place. 5 minutes is standard for a demo-scale swap on an L2 — long enough to survive normal
 * bundler/mempool latency and one block-inclusion delay, short enough that a transaction stuck
 * behind a congestion spike expires and surfaces as a classified retryable `EXPIRED` revert
 * (see `classify-error.ts`) instead of landing minutes later against a materially different
 * pool price. Deliberately NOT derived from the receipt-poll window — a deadline is an
 * on-chain guarantee about when the swap stops being valid, not a guess about how long we're
 * willing to wait for it.
 */
export const SWAP_DEADLINE_SECONDS = 300;

export interface TransactionResult {
  txHash: string;
  status: TxStatus;
  amountIn?: string;
  amountOut?: string;
  /**
   * Classification for a FAILED result (doc 05 §24). Authoritative — the engine never
   * re-derives it.
   *   true  = transient, retry the same transaction without advancing.
   *   false = non-retryable, halt the System immediately.
   *   null  = not (yet) classified, e.g. a still-PENDING receipt that hasn't resolved.
   *
   * CHANGED (Part I): was `retryable?: boolean` (i.e. `boolean | undefined`). Now
   * `boolean | null`, matching `@oplier/amm-execution`'s version — which is the more correct
   * of the two, because `null` ("explicitly unclassified") carries real meaning for the halt
   * logic: `resumeSystem` distinguishes a pending-timeout halt from a classified failure by
   * testing `retryable === null` alongside a PENDING status, and `executions.retryable` is a
   * nullable boolean column in the real schema. The two shapes were bidirectionally
   * incompatible under `strict` (`null` not assignable to `boolean | undefined`, and
   * `undefined` not assignable to `boolean | null`), so one had to move; the engine adopted
   * amm-execution's rather than the reverse.
   */
  retryable?: boolean | null;
  errorLog?: string;
  /** Block the transaction was included in, when the receipt provides it. */
  blockNumber?: number;
}

export interface SwapExecutor {
  executeSwap(params: SwapParams): Promise<SwapExecResult>;
  getReceipt(txHash: string): Promise<TransactionResult>;
}

/**
 * FLAGGED ADDITION (not in the brief's three named interfaces): HIGH_IMPACT_NEWS is one of
 * the 5 MVP condition primitives (doc 04 §2) and the brief's monitoring-cadence section
 * explicitly locks a 60s cycle for it, but no consume-interface was specified for its data
 * source the way Price/Permission/Swap were. Part J owns `high_impact_news_events`
 * (full_schema.txt `news.ts`) and the API layer already reads it for `GET
 * /high-impact-news`. Rather than hardcode a DB query inside the engine (breaking the "mock
 * everything external" build order) or silently skip the condition type, this defines a
 * fourth thin interface mirroring the other three's mock-ability. Flagging back — if Part J
 * or the manager thread wants a different shape, this is the one file to change
 * (`NewsDataProvider` below + its mock).
 */
export interface NewsDataProvider {
  /** True if an event at/above the product's High Impact classification falls within `withinHours` from now. */
  hasUpcomingHighImpactEvent(withinHours: 1 | 24): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// SystemEngineService — produced by this part (API_CONTRACT.md §8, §5).
// ---------------------------------------------------------------------------

export interface SystemEngineService {
  createSystem(walletAddress: string, spec: SystemSpec): Promise<SystemRecord>;
  pauseSystem(systemId: string): Promise<SystemRecord>;
  resumeSystem(systemId: string): Promise<SystemRecord>;
  deleteSystem(systemId: string): Promise<void>;
  modifySystem(
    systemId: string,
    patch: SystemSpecPatch,
    stepModification?: StepModification,
  ): Promise<SystemRecord>;
  reactivateSystem(systemId: string): Promise<SystemRecord>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EngineError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION_ERROR"
      | "UNSUPPORTED_CAPABILITY"
      | "INTERNAL_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}
