import { eq, and, inArray } from "drizzle-orm";
import {
  systems,
  systemRuns,
  systemSteps,
  conditions,
  swaps,
  nexusPermissions,
  type Database,
} from "@oplier/db";
import {
  ApiError,
  type SystemEngineService,
  type SystemSpec,
  type SystemStatus,
} from "@oplier/shared-types";
import type { AssetRegistryService } from "../../registries/asset-registry.service.js";
import type { CapabilityRegistryService } from "../../registries/capability-registry.service.js";
import { validateSystemSpec } from "../../registries/validate-system-spec.js";

/**
 * System lifecycle operations for the API process.
 *
 * AUTHORIZATION IS DELEGATED, NOT SKIPPED. This process has no chain access and deliberately holds
 * neither `SMART_ACCOUNT_OWNER_PRIVATE_KEY` nor `SESSION_KEY_MASTER_SEED`; putting either in an
 * internet-facing service would defeat the reason session keys are derived from a single protected
 * secret in the first place (see apps/worker/src/permissions/session-keys.ts). So every operation
 * here that needs an on-chain Smart Session permission granted or revoked expresses that intent in
 * the database, and `apps/worker` — which already constructs the real `AlchemyPermissionService` and
 * `SystemPermissionLifecycle` — performs it.
 *
 * The two handoff signals, both durable across a restart of either process:
 *   - `systems.status = 'AUTHORIZATION_REQUIRED'` — needs a key granted. Written by createSystem,
 *     permission-relevant modifySystem, reactivateSystem, reauthorizeSystem, and resumeSystem when
 *     no live permission row survives. The worker grants and flips to ACTIVE.
 *   - a `nexus_permissions` row with `status = 'CREATED'` and `system_id = NULL` — needs a key
 *     revoked. Produced automatically by the FK's ON DELETE SET NULL when deleteSystem removes the
 *     System. The worker revokes and marks the row REVOKED.
 *
 * What this means for correctness: a System never reaches ACTIVE without a live permission row, and
 * the engine's own authorization gate (packages/engine/src/step-executor.ts) refuses to submit
 * anything for a System that has no live permission. So the failure mode of a pending or failed
 * grant is "does not execute", not "executes unauthorized".
 *
 * `pauseSystem` is status-only on purpose and is NOT a gap: `SystemPermissionLifecycle` documents
 * pause as a deliberate permission-layer no-op ("Pause: does NOT revoke the session key; execution
 * just stops"), so there is nothing on-chain to hand off.
 *
 * The `Stub` name is now historical — kept only to avoid a rename churning imports; the remaining
 * stub-shaped thing is that this class talks to the database rather than to the chain, which is the
 * intended architecture rather than a placeholder.
 */
export class SystemEngineServiceStub implements SystemEngineService {
  constructor(
    private readonly db: Database,
    private readonly assetRegistry: AssetRegistryService,
    private readonly capabilityRegistry: CapabilityRegistryService,
  ) {}

  async createSystem(walletAddress: string, spec: SystemSpec): Promise<{ systemId: string }> {
    const result = await validateSystemSpec(spec, {
      assetRegistry: this.assetRegistry,
      capabilityRegistry: this.capabilityRegistry,
    });
    if (!result.valid) {
      throw new ApiError("UNSUPPORTED_CAPABILITY", "System spec failed validation.", result.issues);
    }
    const validSpec = result.spec;

    return this.db.transaction(async (tx) => {
      const [systemRow] = await tx
        .insert(systems)
        .values({
          walletAddress,
          name: validSpec.name,
          // NOT "ACTIVE": a System is not authorized to spend anything until the worker has
          // granted its on-chain Smart Session permission. The worker's activation reconciler
          // polls for this status, grants, and only then flips to ACTIVE.
          status: "AUTHORIZATION_REQUIRED",
          maxAllocation: validSpec.maxAllocation,
          maxAllocationAsset: validSpec.maxAllocationAsset,
          executionLimit: validSpec.executionLimit,
          expiresAt: validSpec.expiresAt ? new Date(validSpec.expiresAt) : null,
        })
        .returning();
      if (!systemRow) throw new ApiError("INTERNAL_ERROR", "Failed to create system row.");

      const [runRow] = await tx
        .insert(systemRuns)
        .values({ systemId: systemRow.id, runNumber: 1, status: "ACTIVE" })
        .returning();
      if (!runRow) throw new ApiError("INTERNAL_ERROR", "Failed to create system_runs row.");

      let firstStepId: string | undefined;
      const sortedSteps = [...validSpec.steps].sort((a, b) => a.stepOrder - b.stepOrder);
      for (const step of sortedSteps) {
        const [stepRow] = await tx
          .insert(systemSteps)
          .values({
            systemId: systemRow.id,
            stepOrder: step.stepOrder,
            groupOperator: step.groupOperator,
          })
          .returning();
        if (!stepRow) throw new ApiError("INTERNAL_ERROR", "Failed to create system_steps row.");
        firstStepId ??= stepRow.id;

        for (const condition of step.conditions) {
          await tx.insert(conditions).values({
            stepId: stepRow.id,
            conditionType: condition.conditionType,
            parameters: condition.parameters,
          });
        }

        await tx.insert(swaps).values({
          stepId: stepRow.id,
          sourceAsset: step.swap.sourceAsset,
          destinationAsset: step.swap.destinationAsset,
          amountType: step.swap.amountType,
          amountValue: step.swap.amountValue,
          executionOrder: step.swap.executionOrder,
          maxSlippageBps: step.swap.maxSlippageBps,
        });
      }

      await tx.update(systems).set({ currentRunId: runRow.id }).where(eq(systems.id, systemRow.id));
      if (firstStepId) {
        await tx.update(systemRuns).set({ currentStepId: firstStepId }).where(eq(systemRuns.id, runRow.id));
      }

      // Authorization deliberately does NOT happen here. This process has no chain access and
      // holds neither SMART_ACCOUNT_OWNER_PRIVATE_KEY nor SESSION_KEY_MASTER_SEED — keeping those
      // out of the internet-facing service is the whole point of the split (see the rationale in
      // apps/worker/src/permissions/session-keys.ts). The System is left in
      // AUTHORIZATION_REQUIRED and the worker's activation reconciler performs the grant.
      //
      // doc 04 §18-19 ("no partial System is created if validation or permission creation fails")
      // is still satisfied, just differently: the System never reaches ACTIVE without a permission,
      // and a System stuck in AUTHORIZATION_REQUIRED cannot execute because the engine's own
      // authorization gate (packages/engine step-executor.ts) refuses to submit without a live
      // permission row.

      return { systemId: systemRow.id };
    });
  }

  async modifySystem(
    walletAddress: string,
    systemId: string,
    spec: Partial<SystemSpec>,
  ): Promise<{ systemId: string }> {
    const existing = await this.requireOwnedSystem(walletAddress, systemId);
    if (existing.status === "COMPLETE" || existing.status === "EXPIRED") {
      throw new ApiError(
        "CONFLICT",
        `Cannot modify a System in status ${existing.status} — reactivate it first.`,
      );
    }

    const patch: Partial<typeof systems.$inferInsert> = {};
    if (spec.name !== undefined) patch.name = spec.name;
    if (spec.maxAllocation !== undefined) patch.maxAllocation = spec.maxAllocation;
    if (spec.maxAllocationAsset !== undefined) {
      await this.assetRegistry.validateAsset(spec.maxAllocationAsset);
      patch.maxAllocationAsset = spec.maxAllocationAsset;
    }
    if (spec.executionLimit !== undefined) patch.executionLimit = spec.executionLimit;
    if (spec.expiresAt !== undefined) {
      patch.expiresAt = spec.expiresAt ? new Date(spec.expiresAt) : null;
    }

    /**
     * Does this change alter what the on-chain session key authorizes?
     *
     * doc 02 (via `SystemPermissionLifecycle.modify`) requires that a modification revoke the old
     * session key and grant a new one rather than mutate one in place. That applies to the fields
     * the permission scope actually encodes — spend limit, its denominating asset, expiry, and the
     * steps that determine which contract/functions get called. `name` and `executionLimit` are
     * app-level only (`executionLimit` caps retries in the engine, it is not an on-chain limit), so
     * renaming a System does not invalidate its authorization and must not cost the user a
     * re-authorization round trip plus gas.
     *
     * If that reading is ever tightened to "any modification re-authorizes", this is the one
     * condition to change.
     */
    const permissionRelevantChange =
      spec.maxAllocation !== undefined ||
      spec.maxAllocationAsset !== undefined ||
      spec.expiresAt !== undefined ||
      spec.steps !== undefined;

    // Steps are replaced wholesale, not diffed: `swaps.stepId` is unique and conditions carry
    // per-run trigger state, so merging a partial step list in place would leave stale state
    // attached to steps the caller believes it replaced.
    if (spec.steps !== undefined) {
      const merged = await validateSystemSpec(
        {
          name: patch.name ?? existing.name,
          maxAllocation: patch.maxAllocation ?? existing.maxAllocation,
          maxAllocationAsset: patch.maxAllocationAsset ?? existing.maxAllocationAsset,
          executionLimit: patch.executionLimit ?? existing.executionLimit,
          expiresAt:
            patch.expiresAt !== undefined
              ? (patch.expiresAt?.toISOString() ?? null)
              : (existing.expiresAt?.toISOString() ?? null),
          steps: spec.steps,
        },
        { assetRegistry: this.assetRegistry, capabilityRegistry: this.capabilityRegistry },
      );
      if (!merged.valid) {
        throw new ApiError("UNSUPPORTED_CAPABILITY", "Modified System spec failed validation.", merged.issues);
      }
    }

    return this.db.transaction(async (tx) => {
      if (spec.steps !== undefined) {
        // system_steps CASCADEs to conditions and swaps (see deleteSystem's note), so this one
        // delete clears the whole definition subtree before it is rebuilt.
        await tx.delete(systemSteps).where(eq(systemSteps.systemId, existing.id));

        let firstStepId: string | undefined;
        const sortedSteps = [...spec.steps].sort((a, b) => a.stepOrder - b.stepOrder);
        for (const step of sortedSteps) {
          const [stepRow] = await tx
            .insert(systemSteps)
            .values({
              systemId: existing.id,
              stepOrder: step.stepOrder,
              groupOperator: step.groupOperator,
            })
            .returning();
          if (!stepRow) throw new ApiError("INTERNAL_ERROR", "Failed to replace system_steps row.");
          firstStepId ??= stepRow.id;

          for (const condition of step.conditions) {
            await tx.insert(conditions).values({
              stepId: stepRow.id,
              conditionType: condition.conditionType,
              parameters: condition.parameters,
            });
          }

          await tx.insert(swaps).values({
            stepId: stepRow.id,
            sourceAsset: step.swap.sourceAsset,
            destinationAsset: step.swap.destinationAsset,
            amountType: step.swap.amountType,
            amountValue: step.swap.amountValue,
            executionOrder: step.swap.executionOrder,
            maxSlippageBps: step.swap.maxSlippageBps,
          });
        }

        // The current run pointed at a step that no longer exists.
        if (existing.currentRunId && firstStepId) {
          await tx
            .update(systemRuns)
            .set({ currentStepId: firstStepId })
            .where(eq(systemRuns.id, existing.currentRunId));
        }
      }

      if (permissionRelevantChange) {
        // The worker's reconciler sees AUTHORIZATION_REQUIRED plus an existing live permission and
        // routes to `lifecycle.modify()`, which revokes the old session key before granting the new
        // one. Setting this status is what triggers that; the API never touches the chain itself.
        patch.status = "AUTHORIZATION_REQUIRED";
      }

      if (Object.keys(patch).length > 0) {
        await tx.update(systems).set(patch).where(eq(systems.id, existing.id));
      }
      return { systemId: existing.id };
    });
  }

  async pauseSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }> {
    const existing = await this.requireOwnedSystem(walletAddress, systemId);
    if (existing.status !== "ACTIVE") {
      throw new ApiError("CONFLICT", `Cannot pause a System in status ${existing.status}.`);
    }
    await this.db.update(systems).set({ status: "PAUSED" }).where(eq(systems.id, existing.id));
    return { status: "PAUSED" };
  }

  async resumeSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }> {
    const existing = await this.requireOwnedSystem(walletAddress, systemId);
    if (existing.status !== "PAUSED") {
      throw new ApiError("CONFLICT", `Cannot resume a System in status ${existing.status}.`);
    }

    /**
     * doc 02: "Resume continues with remaining limits, no re-authorization." That holds only while
     * the session key granted at activation still exists — pausing does not revoke it, but a key can
     * expire or be revoked out from under a paused System. If there is no live permission row left,
     * resuming straight to ACTIVE would produce a System the engine's authorization gate blocks on
     * every tick, with nothing telling the user why. Routing to AUTHORIZATION_REQUIRED instead lets
     * the worker grant a fresh key and surfaces "Needs authorization" in the UI meanwhile.
     *
     * This is a row-existence check only. Whether a key that still has a row is *actually* valid
     * on-chain is the worker's call (`lifecycle.resume` / `checkBeforeExecution`) — this process has
     * no chain access to answer it.
     */
    const live = await this.db
      .select({ id: nexusPermissions.id })
      .from(nexusPermissions)
      .where(and(eq(nexusPermissions.systemId, existing.id), eq(nexusPermissions.status, "CREATED")))
      .limit(1);

    const next: SystemStatus = live[0] ? "ACTIVE" : "AUTHORIZATION_REQUIRED";
    await this.db.update(systems).set({ status: next }).where(eq(systems.id, existing.id));
    return { status: next };
  }

  async reactivateSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }> {
    const existing = await this.requireOwnedSystem(walletAddress, systemId);
    if (existing.status !== "COMPLETE" && existing.status !== "EXPIRED") {
      throw new ApiError("CONFLICT", `Cannot reactivate a System in status ${existing.status}.`);
    }

    return this.db.transaction(async (tx) => {
      const existingRuns = await tx
        .select({ runNumber: systemRuns.runNumber })
        .from(systemRuns)
        .where(eq(systemRuns.systemId, existing.id));
      const nextRunNumber = existingRuns.reduce((max, r) => Math.max(max, r.runNumber), 0) + 1;

      const allSteps = await tx
        .select({ id: systemSteps.id })
        .from(systemSteps)
        .where(eq(systemSteps.systemId, existing.id))
        .orderBy(systemSteps.stepOrder);
      const firstStep = allSteps[0];

      const [runRow] = await tx
        .insert(systemRuns)
        .values({
          systemId: existing.id,
          runNumber: nextRunNumber,
          status: "ACTIVE",
          currentStepId: firstStep?.id,
        })
        .returning();
      if (!runRow) throw new ApiError("INTERNAL_ERROR", "Failed to create reactivation run.");

      await tx
        .update(systems)
        .set({ status: "AUTHORIZATION_REQUIRED", currentRunId: runRow.id })
        .where(eq(systems.id, existing.id));

      // Reset condition state for the new run (doc 05 §22: "no previous condition-trigger
      // state") across EVERY step belonging to this System, not just the first one.
      if (allSteps.length > 0) {
        await tx
          .update(conditions)
          .set({ currentState: false })
          .where(
            inArray(
              conditions.stepId,
              allSteps.map((s) => s.id),
            ),
          );
      }

      // A reactivated System needs a brand-new session key: the previous run's key was revoked when
      // the System completed/expired, and doc 04 §14 treats reactivation as a fresh authorization.
      // The worker's reconciler grants it and moves this to ACTIVE.

      return { status: "AUTHORIZATION_REQUIRED" as SystemStatus };
    });
  }

  async reauthorizeSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }> {
    const existing = await this.requireOwnedSystem(walletAddress, systemId);
    if (existing.status === "COMPLETE" || existing.status === "EXPIRED") {
      throw new ApiError(
        "CONFLICT",
        `Cannot reauthorize a System in status ${existing.status} — reactivate it instead.`,
      );
    }

    /**
     * The explicit "my System says it needs authorization, try again" action. It is idempotent by
     * design: setting AUTHORIZATION_REQUIRED is the entire operation, and the worker's reconciler
     * picks it up on its next cycle — granting a fresh key if there is none, or revoking and
     * re-granting via `lifecycle.modify()` if a stale row is still present.
     *
     * This used to throw UNSUPPORTED_CAPABILITY on the grounds that no authorization-required state
     * existed for the backend to detect or recover from. Both halves of that are now false: the
     * status exists, and the worker reports failures against it.
     */
    await this.db
      .update(systems)
      .set({ status: "AUTHORIZATION_REQUIRED" })
      .where(eq(systems.id, existing.id));
    return { status: "AUTHORIZATION_REQUIRED" };
  }

  async deleteSystem(walletAddress: string, systemId: string): Promise<{ deleted: true }> {
    await this.requireOwnedSystem(walletAddress, systemId);
    // On-chain revocation is NOT skipped — it is handed off, because this process cannot sign.
    // FK behavior (Part A's patched schema, see API_CONTRACT.md §4): system_steps/conditions/
    // swaps CASCADE (pure definition data, correctly gone with the System); system_runs/
    // executions/positions/nexus_permissions are nullable with ON DELETE SET NULL, so that
    // history survives this delete with system_id/step_id orphaned to NULL rather than being
    // destroyed. Postgres enforces this automatically from the FK constraints — no application
    // code here needs to (or should) replicate it manually.
    //
    // That SET NULL is exactly the handoff signal: the permission row keeps status CREATED but
    // loses its system_id, which is the shape the worker's revocation sweep looks for (the same
    // query preflight already reports as "orphaned"). The sweep revokes the key on-chain and marks
    // the row REVOKED. So a delete is durable across an API restart — the pending revocation lives
    // in the database, not in this process.
    //
    // Ordering caveat worth knowing: doc 02/doc 05 §33 specify revoke-then-delete, and this is
    // delete-then-revoke. The window between them is bounded by ACTIVATION_CYCLE_MS, and the engine
    // refuses to execute a System whose row is gone, so the key cannot be used by Oplier in the
    // interim. It is still a real window on-chain — see DEPLOYMENT_RUNBOOK.md.
    await this.db.delete(systems).where(eq(systems.id, systemId));
    return { deleted: true };
  }

  private async requireOwnedSystem(walletAddress: string, systemId: string) {
    const rows = await this.db
      .select()
      .from(systems)
      .where(and(eq(systems.id, systemId), eq(systems.walletAddress, walletAddress)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new ApiError("NOT_FOUND", `System "${systemId}" not found.`);
    }
    return row;
  }
}
