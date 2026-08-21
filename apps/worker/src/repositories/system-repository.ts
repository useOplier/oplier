import { and, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "@oplier/db";
import {
  conditions as conditionsTable,
  executions as executionsTable,
  nexusPermissions,
  positions as positionsTable,
  settings as settingsTable,
  swaps as swapsTable,
  systemRuns,
  systemSteps,
  systems as systemsTable,
  transactions as transactionsTable,
} from "@oplier/db";
import type {
  ConditionRecord,
  ExecutionRecord,
  PositionRecord,
  StepBundle,
  SwapRecord,
  SystemRecord,
  SystemRepository,
  SystemRunRecord,
  SystemStepRecord,
  TransactionRecord,
} from "@oplier/engine";

/**
 * Real Drizzle-backed `SystemRepository` — the production implementation of the engine's
 * persistence port.
 *
 * `@oplier/engine` ships `repository/drizzle-adapter.ts` as a fully commented-out reference sketch,
 * excluded from its typecheck, whose own header says "Part I's first job with this file should be
 * running it against a real instance before trusting it." This is that implementation, written
 * against Part B's actual `packages/db` exports rather than the sketch's guesses, and compiled for
 * real.
 *
 * ⚠ NOT YET RUN AGAINST A LIVE DATABASE. It typechecks against the real schema, which rules out
 * wrong column/table names, but no query here has executed. `preflight.ts` exercises the read paths
 * on startup so a schema drift surfaces immediately rather than at the first trigger.
 *
 * Conventions this file holds to, each for a specific reason:
 *
 *  - **Timestamps.** The engine's record types use ISO strings; the schema uses
 *    `timestamp with time zone` (Drizzle hands back `Date`). Every boundary converts explicitly via
 *    `toIso`/`fromIso`. Never `as any` across this boundary — a silent Date-vs-string mismatch would
 *    surface as an invalid-date comparison inside expiration checks, which is exactly the kind of
 *    bug that only shows up once a System is meant to expire.
 *  - **Numerics.** `numeric(38,18)` columns come back as strings, and the engine's types are strings
 *    too, so money values pass straight through without ever becoming a JS `number`.
 *  - **Cascade/SET NULL.** Never emulated in application code — Postgres enforces it from the FK
 *    constraints (API_CONTRACT.md §4 confirmed this needs no application help), so `deleteSystem` is
 *    a bare DELETE.
 */

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function fromIso(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

type SystemRow = typeof systemsTable.$inferSelect;
type RunRow = typeof systemRuns.$inferSelect;
type StepRow = typeof systemSteps.$inferSelect;
type ConditionRow = typeof conditionsTable.$inferSelect;
type SwapRow = typeof swapsTable.$inferSelect;
type ExecutionRow = typeof executionsTable.$inferSelect;
type PositionRow = typeof positionsTable.$inferSelect;
type TransactionRow = typeof transactionsTable.$inferSelect;

function mapSystem(row: SystemRow): SystemRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    name: row.name,
    status: row.status,
    maxAllocation: row.maxAllocation,
    maxAllocationAsset: row.maxAllocationAsset,
    expiresAt: toIso(row.expiresAt),
    executionLimit: row.executionLimit,
    currentRunId: row.currentRunId,
  };
}

function mapRun(row: RunRow): SystemRunRecord {
  return {
    id: row.id,
    systemId: row.systemId,
    runNumber: row.runNumber,
    status: row.status,
    currentStepId: row.currentStepId,
    startedAt: row.startedAt.toISOString(),
    endedAt: toIso(row.endedAt),
  };
}

function mapStep(row: StepRow): SystemStepRecord {
  return {
    id: row.id,
    systemId: row.systemId,
    stepOrder: row.stepOrder,
    groupOperator: row.groupOperator,
  };
}

function mapCondition(row: ConditionRow): ConditionRecord {
  return {
    id: row.id,
    stepId: row.stepId,
    conditionType: row.conditionType,
    // `parameters` is jsonb; the engine's ConditionParameters union is the shape the API layer
    // validated before persisting (API_CONTRACT.md §6), so this is a cast, not a re-parse.
    parameters: row.parameters as ConditionRecord["parameters"],
    currentState: row.currentState,
  };
}

function mapSwap(row: SwapRow): SwapRecord {
  return {
    id: row.id,
    stepId: row.stepId,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountType: row.amountType,
    amountValue: row.amountValue,
    executionOrder: row.executionOrder,
    maxSlippageBps: row.maxSlippageBps,
  };
}

function mapExecution(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    systemId: row.systemId,
    runId: row.runId,
    stepId: row.stepId,
    state: row.state,
    txHash: row.txHash,
    status: row.status,
    retryable: row.retryable,
    errorLog: row.errorLog,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPosition(row: PositionRow): PositionRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    systemId: row.systemId,
    assetId: row.assetId,
    status: row.status,
    costBasis: row.costBasis,
    quantity: row.quantity,
    currentValue: row.currentValue,
    openedAt: row.openedAt.toISOString(),
    closedAt: toIso(row.closedAt),
  };
}

function mapTransaction(row: TransactionRow): TransactionRecord {
  return {
    id: row.id,
    walletAddress: row.walletAddress,
    source: row.source,
    executionId: row.executionId,
    systemId: row.systemId,
    txHash: row.txHash,
    status: row.status,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    blockNumber: row.blockNumber,
  };
}

export class DrizzleSystemRepository implements SystemRepository {
  constructor(private readonly db: Database) {}

  // --- settings ---

  async getUserTimezone(walletAddress: string): Promise<string> {
    const [row] = await this.db
      .select({ timezone: settingsTable.timezone })
      .from(settingsTable)
      .where(eq(settingsTable.walletAddress, walletAddress))
      .limit(1);
    // "UTC" default matches the port's documented contract and the column default.
    return row?.timezone ?? "UTC";
  }

  // --- systems ---

  async getSystem(systemId: string): Promise<SystemRecord | null> {
    const [row] = await this.db.select().from(systemsTable).where(eq(systemsTable.id, systemId)).limit(1);
    return row ? mapSystem(row) : null;
  }

  async createSystemWithSteps(
    system: Omit<SystemRecord, "id" | "currentRunId">,
    stepsInput: Array<{
      groupOperator: SystemStepRecord["groupOperator"];
      conditions: Array<Pick<ConditionRecord, "conditionType" | "parameters">>;
      swap: Omit<SwapRecord, "id" | "stepId">;
    }>,
  ): Promise<{ system: SystemRecord; steps: StepBundle[] }> {
    // One transaction so a partial write can never leave a step with no conditions/swap.
    return this.db.transaction(async (tx) => {
      const [sys] = await tx
        .insert(systemsTable)
        .values({
          walletAddress: system.walletAddress,
          name: system.name,
          status: system.status,
          maxAllocation: system.maxAllocation,
          maxAllocationAsset: system.maxAllocationAsset,
          expiresAt: fromIso(system.expiresAt),
          executionLimit: system.executionLimit,
        })
        .returning();
      if (!sys) throw new Error("Failed to insert system row");

      const bundles: StepBundle[] = [];
      for (let i = 0; i < stepsInput.length; i++) {
        const input = stepsInput[i]!;
        const [step] = await tx
          .insert(systemSteps)
          .values({ systemId: sys.id, stepOrder: i + 1, groupOperator: input.groupOperator })
          .returning();
        if (!step) throw new Error("Failed to insert system_steps row");

        const conditionRows = input.conditions.length
          ? await tx
              .insert(conditionsTable)
              .values(
                input.conditions.map((c) => ({
                  stepId: step.id,
                  conditionType: c.conditionType,
                  parameters: c.parameters,
                })),
              )
              .returning()
          : [];

        const [swap] = await tx
          .insert(swapsTable)
          .values({
            stepId: step.id,
            sourceAsset: input.swap.sourceAsset,
            destinationAsset: input.swap.destinationAsset,
            amountType: input.swap.amountType,
            amountValue: input.swap.amountValue,
            // Step order is the execution order — the engine passes 0 and expects this layer to
            // assign it (see its createSystem call site).
            executionOrder: i + 1,
            maxSlippageBps: input.swap.maxSlippageBps,
          })
          .returning();
        if (!swap) throw new Error("Failed to insert swaps row");

        bundles.push({
          step: mapStep(step),
          conditions: conditionRows.map(mapCondition),
          swap: mapSwap(swap),
        });
      }

      return { system: mapSystem(sys), steps: bundles };
    });
  }

  async updateSystemStatus(systemId: string, status: SystemRecord["status"]): Promise<SystemRecord> {
    const [row] = await this.db
      .update(systemsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(systemsTable.id, systemId))
      .returning();
    if (!row) throw new Error(`system ${systemId} not found`);
    return mapSystem(row);
  }

  async updateSystemCurrentRun(systemId: string, runId: string | null): Promise<SystemRecord> {
    const [row] = await this.db
      .update(systemsTable)
      .set({ currentRunId: runId, updatedAt: new Date() })
      .where(eq(systemsTable.id, systemId))
      .returning();
    if (!row) throw new Error(`system ${systemId} not found`);
    return mapSystem(row);
  }

  async patchSystem(
    systemId: string,
    patch: Partial<
      Pick<SystemRecord, "name" | "maxAllocation" | "maxAllocationAsset" | "executionLimit" | "expiresAt">
    >,
  ): Promise<SystemRecord> {
    // Only assign keys actually present: `patch.expiresAt === null` is a meaningful "clear the
    // expiration" instruction and must be distinguishable from "not provided".
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.maxAllocation !== undefined) set.maxAllocation = patch.maxAllocation;
    if (patch.maxAllocationAsset !== undefined) set.maxAllocationAsset = patch.maxAllocationAsset;
    if (patch.executionLimit !== undefined) set.executionLimit = patch.executionLimit;
    if (patch.expiresAt !== undefined) set.expiresAt = fromIso(patch.expiresAt);

    const [row] = await this.db.update(systemsTable).set(set).where(eq(systemsTable.id, systemId)).returning();
    if (!row) throw new Error(`system ${systemId} not found`);
    return mapSystem(row);
  }

  async deleteSystem(systemId: string): Promise<void> {
    // Bare DELETE: Postgres applies the cascade (steps/conditions/swaps) and SET NULL
    // (runs/executions/positions/permissions) from the FK constraints. No application help needed.
    await this.db.delete(systemsTable).where(eq(systemsTable.id, systemId));
  }

  async listActiveSystems(): Promise<SystemRecord[]> {
    const rows = await this.db.select().from(systemsTable).where(eq(systemsTable.status, "ACTIVE"));
    return rows.map(mapSystem);
  }

  /**
   * Systems the API has persisted and validated but that hold no on-chain authorization yet.
   * `systems.status` is the activation queue: the API cannot sign, so it writes this status and the
   * worker's activation reconciler drains it. Deliberately NOT filtered on "has no permission row" —
   * a modified System sits here *with* a live (now stale) permission, and the reconciler needs to see
   * that case so it can revoke-and-regrant rather than grant a second concurrent key.
   */
  async listSystemsAwaitingAuthorization(): Promise<SystemRecord[]> {
    const rows = await this.db
      .select()
      .from(systemsTable)
      .where(eq(systemsTable.status, "AUTHORIZATION_REQUIRED"));
    return rows.map(mapSystem);
  }

  // --- steps / conditions / swaps ---

  async getStepBundle(stepId: string): Promise<StepBundle | null> {
    const [step] = await this.db.select().from(systemSteps).where(eq(systemSteps.id, stepId)).limit(1);
    if (!step) return null;
    const [conditionRows, swapRows] = await Promise.all([
      this.db.select().from(conditionsTable).where(eq(conditionsTable.stepId, stepId)),
      this.db.select().from(swapsTable).where(eq(swapsTable.stepId, stepId)).limit(1),
    ]);
    const swap = swapRows[0];
    if (!swap) return null; // a step without its swap is not executable
    return { step: mapStep(step), conditions: conditionRows.map(mapCondition), swap: mapSwap(swap) };
  }

  async listStepsForSystem(systemId: string): Promise<StepBundle[]> {
    const stepRows = await this.db
      .select()
      .from(systemSteps)
      .where(eq(systemSteps.systemId, systemId))
      .orderBy(systemSteps.stepOrder);
    const bundles: StepBundle[] = [];
    for (const step of stepRows) {
      const bundle = await this.getStepBundle(step.id);
      if (bundle) bundles.push(bundle);
    }
    return bundles;
  }

  async replaceStepConditions(
    stepId: string,
    conditionsInput: Array<Pick<ConditionRecord, "conditionType" | "parameters">>,
  ): Promise<ConditionRecord[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(conditionsTable).where(eq(conditionsTable.stepId, stepId));
      if (conditionsInput.length === 0) return [];
      const rows = await tx
        .insert(conditionsTable)
        .values(
          conditionsInput.map((c) => ({
            stepId,
            conditionType: c.conditionType,
            parameters: c.parameters,
          })),
        )
        .returning();
      return rows.map(mapCondition);
    });
  }

  async replaceStepSwap(stepId: string, swap: Omit<SwapRecord, "id" | "stepId">): Promise<SwapRecord> {
    // `swaps.stepId` is UNIQUE (exactly one swap per step), so this is an upsert on that key rather
    // than a delete-then-insert, which would briefly leave the step swap-less mid-transaction.
    const [row] = await this.db
      .insert(swapsTable)
      .values({
        stepId,
        sourceAsset: swap.sourceAsset,
        destinationAsset: swap.destinationAsset,
        amountType: swap.amountType,
        amountValue: swap.amountValue,
        executionOrder: swap.executionOrder,
        maxSlippageBps: swap.maxSlippageBps,
      })
      .onConflictDoUpdate({
        target: swapsTable.stepId,
        set: {
          sourceAsset: swap.sourceAsset,
          destinationAsset: swap.destinationAsset,
          amountType: swap.amountType,
          amountValue: swap.amountValue,
          maxSlippageBps: swap.maxSlippageBps,
        },
      })
      .returning();
    if (!row) throw new Error(`failed to upsert swap for step ${stepId}`);
    return mapSwap(row);
  }

  async updateConditionState(conditionId: string, currentState: boolean): Promise<void> {
    await this.db
      .update(conditionsTable)
      .set({ currentState, updatedAt: new Date() })
      .where(eq(conditionsTable.id, conditionId));
  }

  async resetAllConditionStatesForSystem(systemId: string): Promise<void> {
    // Single statement via a subquery on the System's steps — avoids fetching every step id into
    // the process just to build an IN list.
    await this.db
      .update(conditionsTable)
      .set({ currentState: false, updatedAt: new Date() })
      .where(
        sql`${conditionsTable.stepId} IN (SELECT ${systemSteps.id} FROM ${systemSteps} WHERE ${systemSteps.systemId} = ${systemId})`,
      );
  }

  // --- runs ---

  async createRun(systemId: string, runNumber: number): Promise<SystemRunRecord> {
    const [row] = await this.db.insert(systemRuns).values({ systemId, runNumber }).returning();
    if (!row) throw new Error("failed to insert system_runs row");
    return mapRun(row);
  }

  async getRun(runId: string): Promise<SystemRunRecord | null> {
    const [row] = await this.db.select().from(systemRuns).where(eq(systemRuns.id, runId)).limit(1);
    return row ? mapRun(row) : null;
  }

  async getCurrentRun(systemId: string): Promise<SystemRunRecord | null> {
    const system = await this.getSystem(systemId);
    if (!system?.currentRunId) return null;
    return this.getRun(system.currentRunId);
  }

  async updateRunStatus(runId: string, status: SystemRunRecord["status"]): Promise<SystemRunRecord> {
    const [row] = await this.db
      .update(systemRuns)
      // `endedAt` is set for any terminal status and cleared when a run goes back to ACTIVE
      // (halt -> resume), matching the in-memory reference implementation's semantics.
      .set({ status, endedAt: status === "ACTIVE" ? null : new Date() })
      .where(eq(systemRuns.id, runId))
      .returning();
    if (!row) throw new Error(`run ${runId} not found`);
    return mapRun(row);
  }

  async updateRunCurrentStep(runId: string, stepId: string | null): Promise<SystemRunRecord> {
    const [row] = await this.db
      .update(systemRuns)
      .set({ currentStepId: stepId })
      .where(eq(systemRuns.id, runId))
      .returning();
    if (!row) throw new Error(`run ${runId} not found`);
    return mapRun(row);
  }

  async countRunsForSystem(systemId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(systemRuns)
      .where(eq(systemRuns.systemId, systemId));
    return Number(row?.value ?? 0);
  }

  // --- executions (duplicate protection + step lock) ---

  async createExecutionIfAbsent(systemId: string, runId: string, stepId: string): Promise<ExecutionRecord | null> {
    // THIS IS THE LOCK (doc 05 §20). A single INSERT relying on the DB-level unique constraint
    // `executions_system_run_step_unique`; an empty RETURNING means we lost the race, which the port
    // requires be reported as `null` rather than thrown. No SELECT-then-INSERT anywhere — that would
    // reintroduce exactly the race this is guarding against.
    const rows = await this.db
      .insert(executionsTable)
      .values({ systemId, runId, stepId, state: "WAITING", attemptCount: 0 })
      .onConflictDoNothing({
        target: [executionsTable.systemId, executionsTable.runId, executionsTable.stepId],
      })
      .returning();
    const row = rows[0];
    return row ? mapExecution(row) : null;
  }

  /**
   * THIS IS THE OTHER HALF OF THE LOCK. `createExecutionIfAbsent` above only protects the FIRST
   * attempt (the row does not exist yet, so the unique constraint decides the winner). Every later
   * attempt re-claims an existing row, and that used to be an unconditional
   * `updateExecution({ state: "EXECUTING" })` — read the state, then write it, with a gap in between.
   *
   * Two price-cycle ticks that both read `state = 'WAITING'` therefore both passed
   * `attemptStep`'s EXECUTING guard and both submitted: ONE (system, run, step) produced TWO real
   * on-chain swaps (`0x…b267ab0` and `0x…19e2d39`, blocks 38785704/38785805) while `attempt_count`
   * stayed at 1. Two USDG spent for one logical execution.
   *
   * The `state <> 'EXECUTING'` predicate makes the read and the write one statement, so exactly one
   * caller can win. An empty RETURNING means we lost — the caller must NOT submit.
   */
  async claimExecutionForAttempt(executionId: string): Promise<boolean> {
    const rows = await this.db
      .update(executionsTable)
      .set({ state: "EXECUTING", updatedAt: new Date() })
      .where(and(eq(executionsTable.id, executionId), ne(executionsTable.state, "EXECUTING")))
      .returning({ id: executionsTable.id });
    return rows.length > 0;
  }

  async getExecution(executionId: string): Promise<ExecutionRecord | null> {    const [row] = await this.db
      .select()
      .from(executionsTable)
      .where(eq(executionsTable.id, executionId))
      .limit(1);
    return row ? mapExecution(row) : null;
  }

  async getExecutionForStep(runId: string, stepId: string): Promise<ExecutionRecord | null> {
    const [row] = await this.db
      .select()
      .from(executionsTable)
      .where(and(eq(executionsTable.runId, runId), eq(executionsTable.stepId, stepId)))
      .limit(1);
    return row ? mapExecution(row) : null;
  }

  async updateExecution(
    executionId: string,
    patch: Partial<
      Pick<ExecutionRecord, "state" | "txHash" | "status" | "retryable" | "errorLog" | "attemptCount">
    >,
  ): Promise<ExecutionRecord> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    // Presence-checked rather than spread: `retryable: null` and `errorLog: null` are meaningful
    // "clear this" instructions the engine relies on (resume clears a prior classification).
    if (patch.state !== undefined) set.state = patch.state;
    if (patch.txHash !== undefined) set.txHash = patch.txHash;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.retryable !== undefined) set.retryable = patch.retryable;
    if (patch.errorLog !== undefined) set.errorLog = patch.errorLog;
    if (patch.attemptCount !== undefined) set.attemptCount = patch.attemptCount;

    const [row] = await this.db
      .update(executionsTable)
      .set(set)
      .where(eq(executionsTable.id, executionId))
      .returning();
    if (!row) throw new Error(`execution ${executionId} not found`);
    return mapExecution(row);
  }

  // --- positions ---

  async getPosition(systemId: string, assetId: string): Promise<PositionRecord | null> {
    const [row] = await this.db
      .select()
      .from(positionsTable)
      .where(and(eq(positionsTable.systemId, systemId), eq(positionsTable.assetId, assetId)))
      .limit(1);
    return row ? mapPosition(row) : null;
  }

  async upsertPositionOnFill(input: {
    walletAddress: string;
    systemId: string;
    assetId: string;
    filledQuantity: string;
    filledCostInQuoteAsset: string;
  }): Promise<PositionRecord> {
    // Accumulates on the (system_id, asset_id) unique key. Cost basis and quantity are ADDED, which
    // is what produces the weighted average doc 04 §7 requires: total cost / total quantity. Done in
    // SQL rather than read-modify-write so two concurrent fills can't lose one another's update.
    // A fill also reopens a CLOSED position and clears closedAt (SCHEMA.md design decision #2).
    const [row] = await this.db
      .insert(positionsTable)
      .values({
        walletAddress: input.walletAddress,
        systemId: input.systemId,
        assetId: input.assetId,
        status: "OPEN",
        costBasis: input.filledCostInQuoteAsset,
        quantity: input.filledQuantity,
        currentValue: input.filledCostInQuoteAsset,
      })
      .onConflictDoUpdate({
        target: [positionsTable.systemId, positionsTable.assetId],
        set: {
          costBasis: sql`${positionsTable.costBasis} + ${input.filledCostInQuoteAsset}::numeric`,
          quantity: sql`${positionsTable.quantity} + ${input.filledQuantity}::numeric`,
          status: "OPEN",
          closedAt: null,
        },
      })
      .returning();
    if (!row) throw new Error(`failed to upsert position for ${input.systemId}/${input.assetId}`);
    return mapPosition(row);
  }

  async closePositionsForSystem(systemId: string): Promise<void> {
    await this.db
      .update(positionsTable)
      .set({ status: "CLOSED", closedAt: new Date() })
      .where(and(eq(positionsTable.systemId, systemId), eq(positionsTable.status, "OPEN")));
  }

  async reopenPositionsForSystem(systemId: string): Promise<void> {
    await this.db
      .update(positionsTable)
      .set({ status: "OPEN", closedAt: null })
      .where(and(eq(positionsTable.systemId, systemId), eq(positionsTable.status, "CLOSED")));
  }

  // --- transactions ---

  async recordTransaction(tx: Omit<TransactionRecord, "id">): Promise<TransactionRecord> {
    const [row] = await this.db
      .insert(transactionsTable)
      .values({
        walletAddress: tx.walletAddress,
        source: tx.source,
        executionId: tx.executionId,
        systemId: tx.systemId,
        txHash: tx.txHash,
        status: tx.status,
        blockNumber: tx.blockNumber,
        sourceAsset: tx.sourceAsset,
        destinationAsset: tx.destinationAsset,
        amountIn: tx.amountIn,
        amountOut: tx.amountOut,
      })
      .returning();
    if (!row) throw new Error("failed to insert transactions row");
    return mapTransaction(row);
  }

  // --- permissions bookkeeping ---

  async recordPermissionCreated(
    systemId: string,
    ref: { id: string; sessionReference: string | null; scope: unknown },
  ): Promise<void> {
    // The row's id is generated by the DB and is what the engine holds as PermissionRef.id, so the
    // permission layer inserts through `engine-adapter.ts` and this method reconciles the scope.
    // Upsert-by-id keeps it idempotent if the adapter already inserted.
    await this.db
      .insert(nexusPermissions)
      .values({
        id: ref.id,
        systemId,
        status: "CREATED",
        scope: ref.scope as Record<string, unknown>,
        sessionReference: ref.sessionReference,
      })
      .onConflictDoUpdate({
        target: nexusPermissions.id,
        set: { scope: ref.scope as Record<string, unknown>, sessionReference: ref.sessionReference },
      });
  }

  async getActivePermission(systemId: string): Promise<{ id: string; sessionReference: string | null } | null> {
    // "Most recent non-REVOKED row" is what SCHEMA.md defines as a System's active permission —
    // this table is append-style history, not one row per System.
    const [row] = await this.db
      .select({ id: nexusPermissions.id, sessionReference: nexusPermissions.sessionReference })
      .from(nexusPermissions)
      .where(and(eq(nexusPermissions.systemId, systemId), eq(nexusPermissions.status, "CREATED")))
      .orderBy(desc(nexusPermissions.createdAt))
      .limit(1);
    return row ?? null;
  }

  async revokeActivePermission(systemId: string): Promise<{ id: string; sessionReference: string | null } | null> {
    const active = await this.getActivePermission(systemId);
    if (!active) return null;
    await this.db
      .update(nexusPermissions)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(eq(nexusPermissions.id, active.id));
    return active;
  }

  // --- worker-only helpers (not part of the engine port) ---

  /**
   * Systems that are ACTIVE but whose `expiresAt` has passed. Used by the worker's expiration sweep
   * so a System with no price-driven conditions still expires on time — the engine's own
   * `checkExpiration` only runs for Systems it visits during a tick, and a tick only visits Systems
   * whose current step has conditions matching that cadence.
   */
  async listExpiredActiveSystems(now: Date): Promise<SystemRecord[]> {
    const rows = await this.db
      .select()
      .from(systemsTable)
      .where(
        and(
          eq(systemsTable.status, "ACTIVE"),
          sql`${systemsTable.expiresAt} IS NOT NULL AND ${systemsTable.expiresAt} <= ${now}`,
        ),
      );
    return rows.map(mapSystem);
  }

  /** All asset ids referenced by any step of any ACTIVE System — what the price stream must cover. */
  async listAssetsInActiveSystems(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ asset: swapsTable.sourceAsset })
      .from(swapsTable)
      .innerJoin(systemSteps, eq(swapsTable.stepId, systemSteps.id))
      .innerJoin(systemsTable, eq(systemSteps.systemId, systemsTable.id))
      .where(eq(systemsTable.status, "ACTIVE"));
    const destRows = await this.db
      .selectDistinct({ asset: swapsTable.destinationAsset })
      .from(swapsTable)
      .innerJoin(systemSteps, eq(swapsTable.stepId, systemSteps.id))
      .innerJoin(systemsTable, eq(systemSteps.systemId, systemsTable.id))
      .where(eq(systemsTable.status, "ACTIVE"));
    return [...new Set([...rows, ...destRows].map((r) => r.asset))];
  }

  /** Orphaned permission rows (System deleted, FK set null) that are still CREATED — see runbook. */
  async listOrphanedActivePermissions(): Promise<Array<{ id: string; sessionReference: string | null }>> {
    return this.db
      .select({ id: nexusPermissions.id, sessionReference: nexusPermissions.sessionReference })
      .from(nexusPermissions)
      .where(and(isNull(nexusPermissions.systemId), eq(nexusPermissions.status, "CREATED")));
  }

  /**
   * Releases execution locks abandoned by a worker that died mid-attempt, and reports how many.
   *
   * THE BUG THIS FIXES: `attemptStep` sets `state = 'EXECUTING'` to claim the step's lock BEFORE it
   * calls `executeSwap`. If the process dies in that window — a deploy, a SIGKILL, an OOM kill, a
   * systemd restart — the row is left `EXECUTING` with `tx_hash = NULL` forever. Every later tick
   * then takes `attemptStep`'s `!created && state === "EXECUTING"` branch and returns
   * `attempt-in-progress-elsewhere`, deferring to an attempt that no longer exists. The System stays
   * ACTIVE, logs nothing, and never executes again. Observed live: a UPM wedged in exactly this state
   * across three worker restarts.
   *
   * DEPLOYMENT_RUNBOOK.md §3 claims a restart mid-swap is safe because "the next tick finds the
   * existing row and re-polls the same txHash". That is only true once a txHash has been recorded.
   * `tx_hash IS NULL` is the provable case where it has not been, and therefore the case where no
   * transaction can possibly have been submitted — so resetting to WAITING cannot double-spend. The
   * lock is deliberately NOT released when a txHash exists: that row may correspond to a transaction
   * still in flight, and `recheckPendingExecution` owns it.
   *
   * `attemptCount` is left untouched — this is releasing a lock, not granting a fresh retry budget.
   */
  async recoverAbandonedExecutionLocks(): Promise<number> {
    const rows = await this.db
      .update(executionsTable)
      .set({ state: "WAITING", updatedAt: new Date() })
      .where(and(eq(executionsTable.state, "EXECUTING"), isNull(executionsTable.txHash)))
      .returning({ id: executionsTable.id });
    return rows.length;
  }
}
