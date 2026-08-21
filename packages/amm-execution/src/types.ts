/**
 * Core types for Part F.
 *
 * ── `SwapExecutor` shape: confirmed against `ENGINE_CONTRACT.md` ──
 *
 * `ENGINE_CONTRACT.md` and the Part F brief gave two slightly different `SwapExecutor` shapes
 * — the brief's own interface block predates Part C's actual delivered contract. Confirmed:
 * where they disagree, `ENGINE_CONTRACT.md` wins, since it's Part C's real, already-built
 * interface, not a preliminary sketch. Resolved accordingly:
 *   - Method names/return shape for `executeSwap`/`getReceipt` follow ENGINE_CONTRACT.md exactly
 *     (`status: "PENDING" | "SUBMITTED"` on submit; `retryable`/`errorLog` on receipt).
 *   - `SwapParams` carries `amountType`/`amountValue` **unresolved**, per ENGINE_CONTRACT.md
 *     §1's explicit statement that resolving "50% of current balance" into an absolute amount
 *     is this part's job, not upstream of it — not the brief's own interface block, which had
 *     amount already pre-resolved to a plain `amountIn` string.
 * `SwapParams`'s exact field set (`executionId`, `runId`, `permissionRef`, `maxSlippageBps`,
 * `walletAddress`, `deadline`) is reconstructed from ENGINE_CONTRACT.md's prose description
 * plus the brief's non-conflicting fields, since ENGINE_CONTRACT.md references `SwapParams` by
 * name without inlining its full definition. If Part C's actual `src/types.ts` differs, this
 * file is the one to change — nothing downstream in this package depends on exact field names
 * beyond it and `execution/swap-executor.ts`.
 */

export type AmountType = "FIXED" | "CURRENT_BALANCE_PERCENT" | "SYSTEM_START_BALANCE_PERCENT";

export interface SwapParams {
  /** Execution row id (executions.id) — used only for the run-start-balance cache key and logs. */
  executionId: string;
  /** System run id (system_runs.id) — scopes SYSTEM_START_BALANCE_PERCENT's snapshot. */
  runId: string;
  /** assetId (asset_registry.asset_id), e.g. "test_aapl". */
  sourceAsset: string;
  /** assetId (asset_registry.asset_id), e.g. "test_usdg". */
  destinationAsset: string;
  amountType: AmountType;
  /**
   * FIXED: a decimal string in the source asset's human units (e.g. "10" = 10 AAPLx).
   * CURRENT_BALANCE_PERCENT / SYSTEM_START_BALANCE_PERCENT: a percentage 0-100 (e.g. "50").
   */
  amountValue: string;
  maxSlippageBps: number;
  /** Authorizes this call through Part E's Smart Session — passed through untouched. */
  permissionRef: string;
  /** Wallet the swap executes on behalf of / receives output into. */
  walletAddress: string;
  deadline: Date;
}

export type TxStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface TransactionResult {
  status: TxStatus;
  /** null while PENDING — not yet classifiable. Authoritative once non-null (engine never re-derives it). */
  retryable: boolean | null;
  errorLog?: string;
  blockNumber?: number;
  amountOut?: string;
  /**
   * ADDED (Part I): the actual source amount consumed on-chain.
   *
   * doc 05 §16 requires reconciliation to record BOTH sides ("Actual source amount consumed. Actual
   * destination amount received."), and the engine's `TransactionResult` already had `amountIn` —
   * this interface only had `amountOut`, so the consumed side had nowhere to travel. Without it the
   * engine cannot compute a cost basis, which is what every ROI condition depends on.
   *
   * Populated by the worker's reconciling wrapper from the first hop's `Swap` event (this package
   * ships no log decoder by design — see calldata-encoder.ts's note on the zero-viem-dependency
   * design).
   */
  amountIn?: string;
  txHash: string;
}

export interface SwapExecutor {
  executeSwap(params: SwapParams): Promise<{ txHash: string; status: "PENDING" | "SUBMITTED" }>;
  getReceipt(txHash: string): Promise<TransactionResult>;
}

/**
 * Thrown by `executeSwap` for *pre-submission* failures — no transaction ever reaches the
 * chain, so there is no txHash for `getReceipt` to classify later. This covers: no route
 * (unsupported asset pair), an empty/insufficient-liquidity pool (see deliverable #4's
 * empty-pool case), or an amount that resolves to zero/negative.
 *
 * FLAG: neither ENGINE_CONTRACT.md nor the Part F brief specifies how pre-submission failures
 * should surface through `executeSwap`'s narrow `{txHash, status}` return type (which has no
 * FAILED branch). Resolution used here: throw a typed, already-classified error and let the
 * caller (Part C's engine) catch it exactly like a synchronous non-retryable/retryable failure
 * — same `retryable` semantics as `TransactionResult.retryable`, just delivered as a throw
 * instead of a resolved receipt, since no txHash exists yet to key a receipt lookup on.
 */
export class SwapExecutionError extends Error {
  readonly retryable: boolean;
  readonly reason: string;

  constructor(reason: string, retryable: boolean, message: string) {
    super(message);
    this.name = "SwapExecutionError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

/** Read-only chain access this package needs. Implemented for real with viem in apps/worker; mocked in tests. */
export interface ChainReader {
  /** Raw base-unit reserves for a V2 pair, plus which token is token0 (V2 pairs sort by address). */
  getReserves(pairAddress: string): Promise<{
    reserve0: bigint;
    reserve1: bigint;
    token0: string;
    token1: string;
  }>;
  /** Raw base-unit balance of `token` held by `owner`. */
  getBalance(token: string, owner: string): Promise<bigint>;
  getBlockNumber(): Promise<number>;
}

export interface SubmittedTx {
  txHash: string;
}

export interface ChainTransactionReceipt {
  status: "success" | "reverted";
  blockNumber: number;
  /** Decoded/best-effort revert reason string, when available — fed to classification/classify-error.ts. */
  revertReason?: string;
  /** Raw log entries; used by reconciliation/reconcile.ts to pull the actual Swap output amount. */
  logs: Array<{ address: string; topics: string[]; data: string }>;
}

/**
 * The session-key transaction submission primitive Part E owns for real (Alchemy Smart
 * Wallets / Nexus Smart Session). Mocked here since Part E is a parallel, not-yet-wired part —
 * same seam pattern Part C used for `PermissionService`/`PriceDataProvider`. `send` takes
 * already-encoded calldata (this package owns encoding the V2 Router call; Part E owns
 * authorizing and relaying it) and coordinates on the exact call shape with Part E per the
 * brief's explicit instruction ("coordinate the exact call shape ... with Part E").
 */
export interface SessionKeyTransactionSender {
  send(params: {
    to: string;
    data: string;
    permissionRef: string;
  }): Promise<SubmittedTx>;
  /** null = not yet mined (still PENDING). */
  getTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null>;
}

export interface RunStartBalanceStore {
  /** Lazily captures and caches the source-asset balance at the first resolution within a run. */
  getOrSet(runId: string, assetId: string, fetchBalance: () => Promise<bigint>): Promise<bigint>;
}
