import {
  AMM_ROUTER_FUNCTION_SELECTORS,
  resolveAmmRouterAddress,
  type ActivateParams,
  type NexusPermissionRepository,
  type PermissionService,
  type SystemPermissionLifecycle,
} from "@oplier/permissions";
import type { SystemRecord } from "@oplier/engine";
import type { Logger } from "../lib/logger.js";

/**
 * Drains the two authorization queues that `apps/api` writes to.
 *
 * WHY THIS EXISTS: granting or revoking a Smart Session permission needs the owner signer and the
 * session-key master seed. Those live only in this process — deliberately, since the API is
 * internet-facing and `session-keys.ts` explains at length why the at-rest secret surface is kept to
 * one protected env var. So the API expresses authorization *intent* in the database and this
 * reconciler carries it out.
 *
 * The two queues, both durable across a restart of either process:
 *
 *   1. ACTIVATION — `systems.status = 'AUTHORIZATION_REQUIRED'`. Grant a key, then promote to ACTIVE.
 *      A System that already holds a live permission row is a *modification*, not a fresh activation:
 *      `lifecycle.activate()` throws in that case by design (doc 02 does not describe two concurrent
 *      live keys per System), so this routes to `lifecycle.modify()`, which revokes before granting.
 *
 *   2. REVOCATION — a `nexus_permissions` row with `status = 'CREATED'` and `system_id = NULL`. That
 *      shape is produced automatically by the FK's ON DELETE SET NULL when the API deletes a System,
 *      which makes it a durable "revoke this key" instruction rather than something the API had to
 *      remember to send. `preflight.ts` already reports these as orphaned; this actually clears them.
 *
 * Ordering note: revocation runs FIRST. A cycle that grants before revoking would widen the window
 * in which a deleted System's key is still live on-chain, and revocation is the operation with real
 * consequences if delayed.
 *
 * This reconciler never decides *whether* a System should be authorized — the API already validated
 * the spec and the user already asked. It only performs the chain work and reports the outcome.
 */
export interface ActivationReconcilerDeps {
  systems: {
    listSystemsAwaitingAuthorization(): Promise<SystemRecord[]>;
    updateSystemStatus(systemId: string, status: SystemRecord["status"]): Promise<SystemRecord>;
    listOrphanedActivePermissions(): Promise<Array<{ id: string; sessionReference: string | null }>>;
  };
  permissions: NexusPermissionRepository;
  permissionService: PermissionService;
  lifecycle: SystemPermissionLifecycle;
  logger: Logger;
  /** First retry delay after a failed grant. Doubles per consecutive failure, capped by `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Injectable clock so tests do not have to wait on real time. */
  now?: () => number;
}

export interface ReconcileResult {
  granted: number;
  regranted: number;
  revoked: number;
  failed: number;
  skippedBackoff: number;
}

const DEFAULT_BASE_BACKOFF_MS = 30_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;
/** Consecutive failures after which the log level escalates — a System this stuck needs a human. */
const ESCALATE_AFTER_FAILURES = 5;

interface FailureState {
  consecutiveFailures: number;
  nextAttemptAt: number;
}

export class ActivationReconciler {
  private readonly failures = new Map<string, FailureState>();
  private readonly now: () => number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly deps: ActivationReconcilerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  async runOnce(): Promise<ReconcileResult> {
    const result: ReconcileResult = { granted: 0, regranted: 0, revoked: 0, failed: 0, skippedBackoff: 0 };
    // Revocation first — see the ordering note in the module doc.
    await this.sweepRevocations(result);
    await this.grantPending(result);
    return result;
  }

  // ── Queue 1: grant permissions for Systems awaiting authorization ──────────
  private async grantPending(result: ReconcileResult): Promise<void> {
    const pending = await this.deps.systems.listSystemsAwaitingAuthorization();
    if (pending.length === 0) return;

    for (const system of pending) {
      if (!this.isDueForAttempt(system.id)) {
        result.skippedBackoff += 1;
        continue;
      }

      try {
        const existing = await this.deps.permissions.findCurrentForSystem(system.id);
        const isRegrant = Boolean(existing?.sessionReference);
        const params = this.buildParams(system);

        // `activate()` refuses to run when a live permission exists, so the branch is required.
        const outcome = isRegrant
          ? await this.deps.lifecycle.modify(params)
          : await this.deps.lifecycle.activate(params);

        if (outcome.state !== "ACTIVE" || !outcome.permissionRef) {
          // A non-ACTIVE result is the lifecycle reporting a refusal rather than throwing (e.g.
          // AUTHORIZATION_REQUIRED). Leave the System queued and let the backoff apply.
          this.recordFailure(system.id, `lifecycle_state_${outcome.state}`, outcome.reason);
          result.failed += 1;
          continue;
        }

        // Only now is the System allowed to execute. Until this line lands, the engine's own
        // authorization gate would have refused every tick anyway — this is the promotion, not
        // the protection.
        await this.deps.systems.updateSystemStatus(system.id, "ACTIVE");
        this.failures.delete(system.id);
        if (isRegrant) result.regranted += 1;
        else result.granted += 1;

        this.deps.logger.info("activation_granted", {
          systemId: system.id,
          permissionRef: outcome.permissionRef,
          spendLimitAsset: system.maxAllocationAsset,
          maxAllocation: system.maxAllocation,
          regrant: isRegrant,
        });
      } catch (err) {
        this.recordFailure(system.id, "exception", err);
        result.failed += 1;
      }
    }
  }

  private buildParams(system: SystemRecord): ActivateParams {
    return {
      systemId: system.id,
      userWallet: system.walletAddress,
      // Same scope construction engine-adapter.ts uses — router address and the V2 swap signature,
      // passed as an array because Solidity signatures contain commas.
      scopedContract: resolveAmmRouterAddress(),
      scopedFunction: AMM_ROUTER_FUNCTION_SELECTORS,
      maxAllocation: system.maxAllocation,
      // Without this the spend limit would be scoped to USDG regardless of what the System is
      // actually denominated in.
      spendLimitAssetId: system.maxAllocationAsset,
      expiresAt: system.expiresAt ? new Date(system.expiresAt) : undefined,
    };
  }

  // ── Queue 2: revoke keys whose System was deleted ──────────────────────────
  private async sweepRevocations(result: ReconcileResult): Promise<void> {
    const orphaned = await this.deps.systems.listOrphanedActivePermissions();
    if (orphaned.length === 0) return;

    for (const row of orphaned) {
      try {
        if (!row.sessionReference) {
          // No on-chain key was ever recorded for this row, so there is nothing to revoke. Mark it
          // anyway, otherwise it is re-swept on every cycle forever.
          await this.deps.permissions.markRevoked(row.id, new Date(this.now()));
          this.deps.logger.warn("revocation_marked_without_reference", { permissionId: row.id });
          result.revoked += 1;
          continue;
        }

        await this.deps.permissionService.revokePermission(row.sessionReference);
        await this.deps.permissions.markRevoked(row.id, new Date(this.now()));
        result.revoked += 1;
        this.deps.logger.info("revocation_completed", {
          permissionId: row.id,
          sessionReference: row.sessionReference,
        });
      } catch (err) {
        // Deliberately left un-marked so the next cycle retries. A key that fails to revoke is the
        // single most important thing in this file to keep retrying and to keep loud.
        result.failed += 1;
        this.deps.logger.error("revocation_failed", {
          permissionId: row.id,
          sessionReference: row.sessionReference,
          err,
        });
      }
    }
  }

  // ── Backoff ───────────────────────────────────────────────────────────────
  private isDueForAttempt(systemId: string): boolean {
    const state = this.failures.get(systemId);
    if (!state) return true;
    return this.now() >= state.nextAttemptAt;
  }

  private recordFailure(systemId: string, kind: string, detail: unknown): void {
    const previous = this.failures.get(systemId)?.consecutiveFailures ?? 0;
    const consecutiveFailures = previous + 1;
    const delay = Math.min(this.baseBackoffMs * 2 ** (consecutiveFailures - 1), this.maxBackoffMs);
    this.failures.set(systemId, { consecutiveFailures, nextAttemptAt: this.now() + delay });

    const fields = { systemId, kind, consecutiveFailures, retryInMs: delay, detail };
    if (consecutiveFailures >= ESCALATE_AFTER_FAILURES) {
      // Past this point it is not a transient vendor blip. Note that backoff state is in-memory, so
      // a worker restart resets the counter and the System gets retried immediately again.
      this.deps.logger.error("activation_failing_persistently", fields);
    } else {
      this.deps.logger.warn("activation_failed", fields);
    }
  }
}
