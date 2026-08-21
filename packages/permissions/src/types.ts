/**
 * PermissionService — implemented exactly per the Part E brief / ENGINE_CONTRACT.md.
 *
 * This is the vendor-agnostic interface. Part C's engine (and apps/api) depend on this
 * shape only — nothing here leaks Alchemy-specific types, so swapping the v4 Alchemy SDK
 * for v5 later (see FINDINGS.md §2) never touches call sites outside this package.
 */
export interface PermissionService {
  createPermission(params: CreatePermissionParams): Promise<CreatePermissionResult>;

  revokePermission(permissionRef: string): Promise<void>;

  checkPermissionValid(permissionRef: string): Promise<CheckPermissionResult>;
}

export interface CreatePermissionParams {
  systemId: string;
  userWallet: string;
  scopedContract: string;
  /**
   * Function signature(s) or already-computed 4-byte selector(s) the session key may call on
   * `scopedContract`.
   *
   * CHANGED (Part I): was a single comma-separated string. That convention was broken —
   * Solidity signatures contain commas, so splitting on comma shredded them (see
   * `normalizeScopedFunctions` in scope-mapping.ts for the full explanation). An array is now
   * canonical; a bare string is accepted and treated as exactly ONE signature, never split.
   */
  scopedFunction: string | readonly string[];
  /**
   * Token amount, precision per Part A's numeric convention (string, not float — SCHEMA.md /
   * full_schema.txt use `numeric` columns for all money-shaped values; this package never
   * converts to JS `number`).
   */
  maxAllocation: string;
  expiresAt?: Date;
  /**
   * NOT in the brief's literal interface — added reconciling against Part C's real
   * `PermissionScope`, which carries `maxAllocationAsset` (the engine knows which asset the
   * System's allocation is denominated in; this package's original literal-brief interface
   * did not). Optional so existing direct callers of this interface (e.g.
   * `permission-lifecycle.ts`'s own tests) keep working unchanged. Defaults to USDG
   * (`DEFAULT_SPEND_LIMIT_TOKEN_ASSET_ID` in scope-mapping.ts) when omitted, per the master
   * plan's stated default. `engine-adapter.ts` always supplies it from
   * `scope.maxAllocationAsset`.
   */
  spendLimitAssetId?: string;
}

export interface CreatePermissionResult {
  /** Opaque reference stored in nexus_permissions.session_reference — this package's callers
   *  never need to know its internal shape, only that it round-trips through revoke/check. */
  permissionRef: string;
  /** Vendor session payload (Alchemy's session key descriptor). Opaque to callers by design —
   *  same reason `sessionData: unknown` is typed unknown, not a concrete Alchemy type. */
  sessionData: unknown;
}

export interface CheckPermissionResult {
  valid: boolean;
  remainingAllowance?: string;
  reason?: string;
}

/**
 * RECONCILED AGAINST PART C'S REAL types.ts (2026-08-16 update — supersedes the earlier
 * "MISMATCH TO FLAG BACK" guesswork from the first pass of this file, which assumed
 * `PermissionScope` carried the same five fields as this package's own `CreatePermissionParams`
 * under different names. It doesn't. The real shapes, copied verbatim from Part C's
 * `types.ts`, renamed with an `Engine` prefix so they don't collide with this package's own
 * `PermissionScope`-shaped... wait, this package doesn't define a `PermissionScope`, but does
 * define `PermissionService` — the prefix avoids colliding with that):
 *
 *   export interface PermissionScope {
 *     systemId: string;
 *     walletAddress: string;
 *     maxAllocation: string;
 *     maxAllocationAsset: string;
 *     assets: string[];
 *   }
 *   export interface PermissionRef {
 *     id: string;
 *     sessionReference: string | null;
 *   }
 *   export interface PermissionService {
 *     createPermission(scope: PermissionScope): Promise<PermissionRef>;
 *     revokePermission(permissionRef: PermissionRef): Promise<void>;
 *   }
 *
 * Three real differences from what this package originally guessed, now confirmed rather than
 * assumed:
 *
 *   1. **No `scopedContract`/`scopedFunction` at all.** The engine never tells this package
 *      which contract/function to scope the session key to — only `assets` (the System's
 *      involved asset ids) and `maxAllocationAsset` (which one the allocation is denominated
 *      in). Doc 02 still requires contract/function scoping, so *this package* now owns
 *      picking the contract — see chain.ts's `resolveAmmRouterAddress()` and
 *      `AMM_ROUTER_FUNCTION_SELECTORS`: every System routes through the same AMM Router
 *      (Uniswap V2, address confirmed by Part K), so that's a fixed, package-level constant
 *      rather than a per-call
 *      input. `assets[]` itself isn't yet used for anything beyond being recorded in the
 *      `nexus_permissions.scope` JSONB for audit purposes — it would be the natural input for
 *      scoping per-token `approve()` calls too, but that's not wired up yet (see
 *      `engine-adapter.ts`'s header comment) since it doesn't fit this package's own
 *      single-contract/single-function `CreatePermissionParams` shape without either changing
 *      that shape or adding a second call. Flagging as an open follow-up, not silently
 *      dropped.
 *   2. **`revokePermission` takes the full `PermissionRef` object** (`{ id, sessionReference }`),
 *      not a bare string. `id` is presumably the `nexus_permissions.id` DB row id (so the
 *      engine's own repository can hold a stable reference independent of whether a vendor
 *      session was ever actually granted); `sessionReference` is the vendor session id,
 *      nullable — matching `nexus_permissions.session_reference: text` being nullable in
 *      full_schema.txt. `engine-adapter.ts` now persists a row via `NexusPermissionRepository`
 *      on every `createPermission` call specifically so it has a real `id` to hand back.
 *   3. **No `expiresAt` anywhere in `PermissionScope`.** `SystemRecord.expiresAt` exists
 *      (types.ts, Part C), but isn't threaded through to permission creation. Doc 02 wants
 *      "time bounds" as one of the scoping dimensions; right now the engine adapter creates
 *      permissions with no explicit `validUntil` (see `engine-adapter.ts`). **Flag this back**
 *      — either `PermissionScope` should gain an `expiresAt`, or this package needs a
 *      documented way to read `SystemRecord.expiresAt` itself (e.g. through
 *      `SystemRepository`, which Part C's engine already depends on and which
 *      `apps/api` also reads from).
 *
 * `checkPermissionValid` still has no caller in Part C's real interface, confirming the
 * earlier open question rather than resolving it: `SystemPermissionLifecycle.checkBeforeExecution`
 * (this package's own lifecycle layer) remains the only place doc 02's "exceeds existing
 * permission → blocked, not auto-expanded" rule is actually enforced. Still worth confirming
 * with the manager thread whether Part F's `SwapExecutor` or Part C's engine should also call
 * it directly before submitting a swap.
 */
export interface EnginePermissionScope {
  systemId: string;
  walletAddress: string;
  maxAllocation: string;
  maxAllocationAsset: string;
  assets: string[];
  /**
   * RESOLVED (Part I) — this was open item #3 in the block above ("No `expiresAt` anywhere in
   * `PermissionScope`... Doc 02 wants 'time bounds' as one of the scoping dimensions; right now
   * the engine adapter creates permissions with no explicit validUntil"). Part C's
   * `PermissionScope` now carries it, so `engine-adapter.ts` threads it into `expirySec`. ISO
   * string (matching `SystemRecord.expiresAt`); `null` = the System has no expiration, in which
   * case scope-mapping.ts applies `DEFAULT_PERMISSION_LIFETIME_SECONDS`.
   */
  expiresAt: string | null;
}

export interface EnginePermissionRef {
  id: string;
  sessionReference: string | null;
}

export interface EnginePermissionService {
  createPermission(scope: EnginePermissionScope): Promise<EnginePermissionRef>;
  revokePermission(permissionRef: EnginePermissionRef): Promise<void>;
}

/** doc 02 "System authorization lifecycle" states this package's lifecycle layer manages. */
export type PermissionLifecycleState =
  | "PENDING_AUTHORIZATION"
  | "ACTIVE"
  | "PAUSED"
  | "AUTHORIZATION_REQUIRED"
  | "REVOKED";

/** Mirrors full_schema.txt nexus_permissions.status — CREATED | REVOKED at the row level;
 *  the richer PermissionLifecycleState above is this package's in-memory/application-level
 *  view built on top of a sequence of CREATED/REVOKED rows (append-style history, SCHEMA.md
 *  "Assets & pricing" / nexus_permissions section). */
export type NexusPermissionRowStatus = "CREATED" | "REVOKED";

export interface SystemPermissionScope {
  systemId: string;
  userWallet: string;
  scopedContract: string;
  /** See `CreatePermissionParams.scopedFunction` — array canonical, bare string = one signature. */
  scopedFunction: string | readonly string[];
  maxAllocation: string;
  expiresAt?: Date;
  /** doc 02 (locked): permissions are scoped per chain. X Layer testnet = 1952 — see
   *  FINDINGS.md §1 and chain.ts. Included explicitly rather than assumed, since a future
   *  mainnet System should not silently inherit a testnet chain id. */
  chainId: number;
}
