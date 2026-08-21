import type { PermissionService, PermissionLifecycleState } from "../types";
import type { NexusPermissionRepository, NexusPermissionRow } from "../repository/types";

/**
 * Live System status, read straight from `systems.status` at check time.
 *
 * ADDED (Part I) as the defense-in-depth backstop for the revocation gap documented in
 * `alchemy-permission-service.ts`: the hosted Alchemy session API is expiry-only, so a session key
 * can outlive the System it belongs to if on-chain `uninstallValidation` is delayed, unwired, or
 * fails. This is the software-layer gate that stops a deleted/paused/halted System from executing
 * anyway. It is NOT a replacement for real on-chain revocation — see that file's header.
 */
export interface SystemStatusReader {
  /**
   * Current `systems.status`, or `null` if the System no longer exists (doc 04 §20: deletion
   * removes the row entirely — DELETED is not a status), which must also block execution.
   */
  getSystemStatus(
    systemId: string,
  ): Promise<
    "ACTIVE" | "PAUSED" | "HALTED" | "EXPIRED" | "COMPLETE" | "AUTHORIZATION_REQUIRED" | null
  >;
}

export interface ActivateParams {
  systemId: string;
  userWallet: string;
  scopedContract: string;
  /** Array canonical, bare string = exactly one signature — mirrors `CreatePermissionParams`. */
  scopedFunction: string | readonly string[];
  maxAllocation: string;
  expiresAt?: Date;
  /**
   * Asset the spend limit is denominated in. Forwarded to `CreatePermissionParams.spendLimitAssetId`,
   * which defaults to USDG (`DEFAULT_SPEND_LIMIT_TOKEN_ASSET_ID`) when omitted.
   *
   * ADDED: this interface previously had no way to express it, so every permission created through
   * the lifecycle was silently scoped against USDG even when the System's `maxAllocationAsset` was
   * something else — the spend limit would have been enforced on the wrong token. `engine-adapter.ts`
   * always supplied it on the `CreatePermissionParams` path; the lifecycle path could not.
   * Optional, so existing callers and tests are unaffected.
   */
  spendLimitAssetId?: string;
}

export interface LifecycleResult {
  state: PermissionLifecycleState;
  permissionRef: string | null;
  reason?: string;
}

/**
 * Implements doc 02 "System authorization lifecycle" / "Smart wallet infrastructure" exactly
 * as the brief's "Core responsibilities" #3-7 describe. This is this project's own state
 * machine, layered on top of the vendor-facing `PermissionService` — it's the part of Part E
 * that doesn't depend on Alchemy actually working (see FINDINGS.md), so it's fully testable
 * against a mock today (test/permission-lifecycle.test.ts).
 *
 * Deliberately does NOT track "PAUSED" as a nexus_permissions row state — SCHEMA.md is
 * explicit that pause/resume doesn't touch the session key at all ("Pause: does NOT revoke
 * the session key; execution just stops"). Pause/resume are therefore Part C/B's concern
 * (systems.status), not this table's — this class exposes `pause`/`resume` only as no-ops
 * that assert the current permission is still valid, for callers that want to confirm nothing
 * needs reauthorization before resuming.
 */
export class SystemPermissionLifecycle {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly repository: NexusPermissionRepository,
    /**
     * Optional so existing direct callers/tests keep working, but the worker ALWAYS supplies it —
     * without it, `checkBeforeExecution` cannot enforce the DB-status gate and logs that it is
     * running without its backstop. See `SystemStatusReader`.
     */
    private readonly systemStatus?: SystemStatusReader,
  ) {}

  /** doc 02 Activation: System created → validated → shown to user → user activates → user
   *  authorizes required permissions → System becomes ACTIVE. This method is the "user
   *  authorizes" step — call it once the user has approved, not at System-creation time. */
  async activate(params: ActivateParams): Promise<LifecycleResult> {
    const existing = await this.repository.findCurrentForSystem(params.systemId);
    if (existing) {
      // Re-activating a System that already has a live permission is a modify(), not a fresh
      // activate() — doc 02 doesn't describe two concurrent live session keys per System.
      throw new Error(
        `System ${params.systemId} already has an active permission (${existing.id}) — use modify() to change it, not activate() again.`,
      );
    }

    const { permissionRef, sessionData } = await this.permissionService.createPermission({
      systemId: params.systemId,
      userWallet: params.userWallet,
      scopedContract: params.scopedContract,
      scopedFunction: params.scopedFunction,
      maxAllocation: params.maxAllocation,
      expiresAt: params.expiresAt,
      spendLimitAssetId: params.spendLimitAssetId,
    });

    await this.repository.insert({
      systemId: params.systemId,
      sessionReference: permissionRef,
      scope: {
        scopedContract: params.scopedContract,
        scopedFunction: params.scopedFunction,
        maxAllocation: params.maxAllocation,
        expiresAt: params.expiresAt ?? null,
        sessionData,
      },
    });

    return { state: "ACTIVE", permissionRef };
  }

  /** doc 02 Pause: no-op at the permission layer by design (see class doc comment above). */
  async pause(systemId: string): Promise<LifecycleResult> {
    const current = await this.repository.findCurrentForSystem(systemId);
    if (!current?.sessionReference) {
      return { state: "AUTHORIZATION_REQUIRED", permissionRef: null, reason: "no_active_permission" };
    }
    return { state: "PAUSED", permissionRef: current.sessionReference };
  }

  /** doc 02 Pause: "Resume continues with remaining limits, no re-authorization." This checks
   *  the existing session key is still valid (not expired/revoked out from under the System
   *  while paused) but never creates a new one — creating a new permission here would violate
   *  "no re-authorization" as written. */
  async resume(systemId: string): Promise<LifecycleResult> {
    const current = await this.repository.findCurrentForSystem(systemId);
    if (!current?.sessionReference) {
      return { state: "AUTHORIZATION_REQUIRED", permissionRef: null, reason: "no_active_permission" };
    }
    const check = await this.permissionService.checkPermissionValid(current.sessionReference);
    if (!check.valid) {
      // doc 02 (locked): invalid/failed authorization blocks execution and requires manual
      // reauthorization — it does NOT auto re-request. Surfacing AUTHORIZATION_REQUIRED here
      // rather than silently calling activate() again is the point of this branch.
      return {
        state: "AUTHORIZATION_REQUIRED",
        permissionRef: current.sessionReference,
        reason: check.reason ?? "permission_invalid",
      };
    }
    return { state: "ACTIVE", permissionRef: current.sessionReference };
  }

  /** doc 02 Delete: fully revokes the session key — System cannot continue executing after. */
  async delete(systemId: string): Promise<LifecycleResult> {
    const current = await this.repository.findCurrentForSystem(systemId);
    if (current?.sessionReference) {
      await this.permissionService.revokePermission(current.sessionReference);
      await this.repository.markRevoked(current.id, new Date());
    }
    return { state: "REVOKED", permissionRef: null };
  }

  /** doc 02 Modification: every modification revokes the old session key and creates a new
   *  one from the modified System definition — never mutates an existing session key in
   *  place, even for a smaller/narrower change. */
  async modify(params: ActivateParams): Promise<LifecycleResult> {
    const current = await this.repository.findCurrentForSystem(params.systemId);
    if (current?.sessionReference) {
      await this.permissionService.revokePermission(current.sessionReference);
      await this.repository.markRevoked(current.id, new Date());
    }

    const { permissionRef, sessionData } = await this.permissionService.createPermission({
      systemId: params.systemId,
      userWallet: params.userWallet,
      scopedContract: params.scopedContract,
      scopedFunction: params.scopedFunction,
      maxAllocation: params.maxAllocation,
      expiresAt: params.expiresAt,
      spendLimitAssetId: params.spendLimitAssetId,
    });

    await this.repository.insert({
      systemId: params.systemId,
      sessionReference: permissionRef,
      scope: {
        scopedContract: params.scopedContract,
        scopedFunction: params.scopedFunction,
        maxAllocation: params.maxAllocation,
        expiresAt: params.expiresAt ?? null,
        sessionData,
      },
    });

    return { state: "ACTIVE", permissionRef };
  }

  /**
   * doc 02 (locked): "If a transaction would exceed existing session key limits, do NOT
   * auto-request expanded permissions — this must surface as a blocked state requiring
   * explicit user action." This is the guard Part F's swap executor (or Part C's engine,
   * per the open question flagged in types.ts) should call before submitting a transaction
   * against the current permission. It NEVER calls createPermission/modify on the caller's
   * behalf — the whole point of this method is that expansion is not automatic.
   *
   * `requestedAmount` vs `remainingAllowance` comparison is done as a decimal string compare
   * via a minimal helper (see `compareDecimalStrings` below) — this package never converts
   * either value to a JS `number`, same numeric-precision reasoning as everywhere else here.
   */
  async checkBeforeExecution(
    systemId: string,
    requestedAmount: string,
  ): Promise<{ allowed: boolean; state: PermissionLifecycleState; reason?: string }> {
    // GATE 1 (Part I, checked FIRST and deliberately before any permission lookup): the System's
    // own live status. This is the defense-in-depth backstop for the revocation gap in
    // alchemy-permission-service.ts — the hosted session API is expiry-only, so an on-chain
    // session key can outlive its System. Checking the DB here means a System that has been
    // deleted, paused, halted, expired, or completed cannot execute even while its session key is
    // still technically valid on-chain.
    //
    // Ordered first on purpose: a deleted System has no permission row to find either, and
    // "system_deleted" is a far more actionable reason in an incident than "no_active_permission".
    if (this.systemStatus) {
      const status = await this.systemStatus.getSystemStatus(systemId);
      if (status === null) {
        return { allowed: false, state: "REVOKED", reason: "system_deleted" };
      }
      if (status !== "ACTIVE") {
        return { allowed: false, state: "REVOKED", reason: `system_status_${status.toLowerCase()}` };
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[permissions] checkBeforeExecution(${systemId}) running without a SystemStatusReader — ` +
          `the DB-status backstop is DISABLED. Wire one (apps/worker does) so a deleted or paused ` +
          `System cannot execute through a still-valid on-chain session key.`,
      );
    }

    const current = await this.repository.findCurrentForSystem(systemId);
    if (!current?.sessionReference) {
      return { allowed: false, state: "AUTHORIZATION_REQUIRED", reason: "no_active_permission" };
    }

    const check = await this.permissionService.checkPermissionValid(current.sessionReference);
    if (!check.valid) {
      return {
        allowed: false,
        state: "AUTHORIZATION_REQUIRED",
        reason: check.reason ?? "permission_invalid",
      };
    }

    if (
      check.remainingAllowance !== undefined &&
      compareDecimalStrings(requestedAmount, check.remainingAllowance) > 0
    ) {
      // Blocked, not auto-expanded — this branch is the one doc 02 is explicit about, and the
      // one the brief's deliverable #4 asks to be test-covered specifically.
      return {
        allowed: false,
        state: "AUTHORIZATION_REQUIRED",
        reason: "requested_amount_exceeds_remaining_allowance",
      };
    }

    return { allowed: true, state: "ACTIVE" };
  }
}

/**
 * Minimal decimal-string comparator (no float conversion) — good enough for the fixed-point
 * "amount" strings this package handles (SCHEMA.md numeric convention). Not a general bignum
 * library; if either input can be arbitrary-precision beyond what this handles, swap in a real
 * decimal library (e.g. the `decimal.js` or `mathjs` already available elsewhere in the repo)
 * rather than extending this by hand.
 */
export function compareDecimalStrings(a: string, b: string): number {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const fracLen = Math.max(aFrac.length, bFrac.length);
  const aNorm = BigInt(aInt + aFrac.padEnd(fracLen, "0"));
  const bNorm = BigInt(bInt + bFrac.padEnd(fracLen, "0"));
  if (aNorm > bNorm) return 1;
  if (aNorm < bNorm) return -1;
  return 0;
}

export type { NexusPermissionRow };
