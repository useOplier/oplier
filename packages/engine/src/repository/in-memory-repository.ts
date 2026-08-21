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
import type { StepBundle, SystemRepository } from "./types.js";

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/**
 * In-memory reference implementation of `SystemRepository`. Mirrors the real schema's FK
 * behavior (full_schema.txt §8a) closely enough to exercise the engine's tests:
 * - deleting a System cascades `system_steps`/`conditions`/`swaps`.
 * - deleting a System SET NULLs `system_runs`/`executions`/`positions`/`nexus_permissions`'s
 *   systemId (and `executions.stepId`), never deletes those rows.
 * - `executions` uniqueness is (systemId, runId, stepId).
 *
 * Not intended for production use — see `drizzle-adapter.ts` for that.
 */
export class InMemorySystemRepository implements SystemRepository {
  systems = new Map<string, SystemRecord>();
  steps = new Map<string, SystemStepRecord>();
  conditions = new Map<string, ConditionRecord>();
  swaps = new Map<string, SwapRecord>(); // keyed by stepId (unique FK)
  runs = new Map<string, SystemRunRecord>();
  executions = new Map<string, ExecutionRecord>();
  positions = new Map<string, PositionRecord>(); // keyed by `${systemId}:${assetId}`
  transactions = new Map<string, TransactionRecord>();
  permissions = new Map<string, { id: string; systemId: string | null; sessionReference: string | null; status: "CREATED" | "REVOKED" }>();

  userTimezones = new Map<string, string>();

  async getUserTimezone(walletAddress: string) {
    return this.userTimezones.get(walletAddress) ?? "UTC";
  }

  async getSystem(systemId: string) {
    return this.systems.get(systemId) ?? null;
  }

  async createSystemWithSteps(
    system: Omit<SystemRecord, "id" | "currentRunId">,
    stepsInput: Array<{
      groupOperator: SystemStepRecord["groupOperator"];
      conditions: Array<Pick<ConditionRecord, "conditionType" | "parameters">>;
      swap: Omit<SwapRecord, "id" | "stepId">;
    }>,
  ) {
    const id = nextId("sys");
    const record: SystemRecord = { ...system, id, currentRunId: null };
    this.systems.set(id, record);

    const steps: StepBundle[] = [];
    stepsInput.forEach((s, idx) => {
      const stepId = nextId("step");
      const step: SystemStepRecord = {
        id: stepId,
        systemId: id,
        stepOrder: idx + 1,
        groupOperator: s.groupOperator,
      };
      this.steps.set(stepId, step);

      const conditions: ConditionRecord[] = s.conditions.map((c) => {
        const conditionId = nextId("cond");
        const rec: ConditionRecord = {
          id: conditionId,
          stepId,
          conditionType: c.conditionType,
          parameters: c.parameters,
          currentState: false,
        };
        this.conditions.set(conditionId, rec);
        return rec;
      });

      const swap: SwapRecord = { ...s.swap, id: nextId("swap"), stepId };
      this.swaps.set(stepId, swap);

      steps.push({ step, conditions, swap });
    });

    return { system: record, steps };
  }

  async updateSystemStatus(systemId: string, status: SystemRecord["status"]) {
    const s = this.mustGetSystem(systemId);
    s.status = status;
    return s;
  }

  async updateSystemCurrentRun(systemId: string, runId: string | null) {
    const s = this.mustGetSystem(systemId);
    s.currentRunId = runId;
    return s;
  }

  async patchSystem(systemId: string, patch: Partial<Pick<SystemRecord, "name" | "maxAllocation" | "maxAllocationAsset" | "executionLimit" | "expiresAt">>) {
    const s = this.mustGetSystem(systemId);
    Object.assign(s, patch);
    return s;
  }

  async deleteSystem(systemId: string) {
    // cascade: system_steps -> conditions, swaps
    for (const step of [...this.steps.values()].filter((st) => st.systemId === systemId)) {
      for (const cond of [...this.conditions.values()].filter((c) => c.stepId === step.id)) {
        this.conditions.delete(cond.id);
      }
      this.swaps.delete(step.id);
      this.steps.delete(step.id);
    }
    // SET NULL: system_runs, executions (systemId + stepId), positions, nexus_permissions
    for (const run of this.runs.values()) {
      if (run.systemId === systemId) run.systemId = null;
    }
    for (const exec of this.executions.values()) {
      if (exec.systemId === systemId) exec.systemId = null;
      // exec.stepId already pointed at a now-deleted step; SET NULL applies the same way
      if (exec.stepId && !this.steps.has(exec.stepId)) exec.stepId = null;
    }
    for (const pos of this.positions.values()) {
      if (pos.systemId === systemId) pos.systemId = null;
    }
    for (const perm of this.permissions.values()) {
      if (perm.systemId === systemId) perm.systemId = null;
    }
    this.systems.delete(systemId);
  }

  async listActiveSystems() {
    return [...this.systems.values()].filter((s) => s.status === "ACTIVE");
  }

  async getStepBundle(stepId: string): Promise<StepBundle | null> {
    const step = this.steps.get(stepId);
    if (!step) return null;
    const conditions = [...this.conditions.values()].filter((c) => c.stepId === stepId);
    const swap = this.swaps.get(stepId);
    if (!swap) return null;
    return { step, conditions, swap };
  }

  async listStepsForSystem(systemId: string) {
    const steps = [...this.steps.values()]
      .filter((s) => s.systemId === systemId)
      .sort((a, b) => a.stepOrder - b.stepOrder);
    const bundles: StepBundle[] = [];
    for (const step of steps) {
      const bundle = await this.getStepBundle(step.id);
      if (bundle) bundles.push(bundle);
    }
    return bundles;
  }

  async replaceStepConditions(stepId: string, conditions: Array<Pick<ConditionRecord, "conditionType" | "parameters">>) {
    for (const cond of [...this.conditions.values()].filter((c) => c.stepId === stepId)) {
      this.conditions.delete(cond.id);
    }
    const created: ConditionRecord[] = conditions.map((c) => {
      const id = nextId("cond");
      const rec: ConditionRecord = { id, stepId, conditionType: c.conditionType, parameters: c.parameters, currentState: false };
      this.conditions.set(id, rec);
      return rec;
    });
    return created;
  }

  async replaceStepSwap(stepId: string, swap: Omit<SwapRecord, "id" | "stepId">) {
    const existing = this.swaps.get(stepId);
    const rec: SwapRecord = { ...swap, id: existing?.id ?? nextId("swap"), stepId };
    this.swaps.set(stepId, rec);
    return rec;
  }

  async updateConditionState(conditionId: string, currentState: boolean) {
    const c = this.conditions.get(conditionId);
    if (c) c.currentState = currentState;
  }

  async resetAllConditionStatesForSystem(systemId: string) {
    const stepIds = new Set([...this.steps.values()].filter((s) => s.systemId === systemId).map((s) => s.id));
    for (const c of this.conditions.values()) {
      if (stepIds.has(c.stepId)) c.currentState = false;
    }
  }

  async createRun(systemId: string, runNumber: number) {
    const id = nextId("run");
    const rec: SystemRunRecord = {
      id,
      systemId,
      runNumber,
      status: "ACTIVE",
      currentStepId: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    this.runs.set(id, rec);
    return rec;
  }

  async getRun(runId: string) {
    return this.runs.get(runId) ?? null;
  }

  async getCurrentRun(systemId: string) {
    const s = this.systems.get(systemId);
    if (!s?.currentRunId) return null;
    return this.runs.get(s.currentRunId) ?? null;
  }

  async updateRunStatus(runId: string, status: SystemRunRecord["status"]) {
    const r = this.mustGetRun(runId);
    r.status = status;
    if (status !== "ACTIVE") r.endedAt = new Date().toISOString();
    return r;
  }

  async updateRunCurrentStep(runId: string, stepId: string | null) {
    const r = this.mustGetRun(runId);
    r.currentStepId = stepId;
    return r;
  }

  async countRunsForSystem(systemId: string) {
    return [...this.runs.values()].filter((r) => r.systemId === systemId).length;
  }

  async createExecutionIfAbsent(systemId: string, runId: string, stepId: string) {    const exists = [...this.executions.values()].some(
      (e) => e.systemId === systemId && e.runId === runId && e.stepId === stepId,
    );
    if (exists) return null;
    const id = nextId("exec");
    const now = new Date().toISOString();
    const rec: ExecutionRecord = {
      id,
      systemId,
      runId,
      stepId,
      state: "WAITING",
      txHash: null,
      status: null,
      retryable: null,
      errorLog: null,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.executions.set(id, rec);
    return rec;
  }

  async getExecution(executionId: string) {
    return this.executions.get(executionId) ?? null;
  }

  async getExecutionForStep(runId: string, stepId: string) {
    return [...this.executions.values()].find((e) => e.runId === runId && e.stepId === stepId) ?? null;
  }

  /**
   * Single-threaded mirror of the real CAS claim. JS has no interleaving between the read and the
   * write here, so this cannot exhibit the race it guards against — but it MUST still reject a
   * second claim on an already-EXECUTING row, otherwise tests would pass against semantics the
   * Postgres adapter does not have.
   */
  async claimExecutionForAttempt(executionId: string): Promise<boolean> {
    const rec = this.executions.get(executionId);
    if (!rec || rec.state === "EXECUTING") return false;
    rec.state = "EXECUTING";
    rec.updatedAt = new Date().toISOString();
    return true;
  }

  async updateExecution(
    executionId: string,
    patch: Partial<Pick<ExecutionRecord, "state" | "txHash" | "status" | "retryable" | "errorLog" | "attemptCount">>,
  ) {
    const e = this.executions.get(executionId);
    if (!e) throw new Error(`execution ${executionId} not found`);
    Object.assign(e, patch, { updatedAt: new Date().toISOString() });
    return e;
  }

  async getPosition(systemId: string, assetId: string) {
    return this.positions.get(`${systemId}:${assetId}`) ?? null;
  }

  async upsertPositionOnFill(input: {
    walletAddress: string;
    systemId: string;
    assetId: string;
    filledQuantity: string;
    filledCostInQuoteAsset: string;
  }) {
    const key = `${input.systemId}:${input.assetId}`;
    const existing = this.positions.get(key);
    const addQty = Number(input.filledQuantity);
    const addCost = Number(input.filledCostInQuoteAsset);
    if (existing) {
      const newQty = Number(existing.quantity) + addQty;
      const newCostBasis = Number(existing.costBasis) + addCost;
      existing.quantity = String(newQty);
      existing.costBasis = String(newCostBasis);
      existing.status = "OPEN";
      if (existing.closedAt) existing.closedAt = null;
      return existing;
    }
    const rec: PositionRecord = {
      id: nextId("pos"),
      walletAddress: input.walletAddress,
      systemId: input.systemId,
      assetId: input.assetId,
      status: "OPEN",
      costBasis: String(addCost),
      quantity: String(addQty),
      currentValue: String(addCost),
      openedAt: new Date().toISOString(),
      closedAt: null,
    };
    this.positions.set(key, rec);
    return rec;
  }

  async closePositionsForSystem(systemId: string) {
    for (const p of this.positions.values()) {
      if (p.systemId === systemId && p.status === "OPEN") {
        p.status = "CLOSED";
        p.closedAt = new Date().toISOString();
      }
    }
  }

  async reopenPositionsForSystem(systemId: string) {
    for (const p of this.positions.values()) {
      if (p.systemId === systemId && p.status === "CLOSED") {
        p.status = "OPEN";
        p.closedAt = null;
      }
    }
  }

  async recordTransaction(tx: Omit<TransactionRecord, "id">) {
    const rec: TransactionRecord = { ...tx, id: nextId("txn") };
    this.transactions.set(rec.id, rec);
    return rec;
  }

  async recordPermissionCreated(systemId: string, ref: { id: string; sessionReference: string | null }) {
    this.permissions.set(ref.id, { id: ref.id, systemId, sessionReference: ref.sessionReference, status: "CREATED" });
  }

  async getActivePermission(systemId: string) {
    const active = [...this.permissions.values()].find((p) => p.systemId === systemId && p.status === "CREATED");
    if (!active) return null;
    return { id: active.id, sessionReference: active.sessionReference };
  }

  async revokeActivePermission(systemId: string) {
    const active = [...this.permissions.values()].find((p) => p.systemId === systemId && p.status === "CREATED");
    if (!active) return null;
    active.status = "REVOKED";
    return { id: active.id, sessionReference: active.sessionReference };
  }

  private mustGetSystem(systemId: string): SystemRecord {
    const s = this.systems.get(systemId);
    if (!s) throw new Error(`system ${systemId} not found`);
    return s;
  }

  private mustGetRun(runId: string): SystemRunRecord {
    const r = this.runs.get(runId);
    if (!r) throw new Error(`run ${runId} not found`);
    return r;
  }
}
