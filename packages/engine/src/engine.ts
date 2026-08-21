/**
 * UpmEngine — the orchestrator tying together condition-evaluator.ts, step-executor.ts,
 * and state-machine.ts, and the concrete `SystemEngineService` Part B stubbed
 * (API_CONTRACT.md §8, §5).
 *
 * Cadence design note (brief responsibility #13 — LOCKED cadence: price/percent 5-10s,
 * ROI on price refresh, TIME scheduler-based, HIGH_IMPACT_NEWS 60s, "implement both cycles
 * as configurable engine-level settings"):
 *
 * Per-condition `currentState` is the schema's actual persisted source of truth (see
 * `conditions.ts`'s comment in full_schema.txt), not a group-level flag. That makes cadence
 * separation natural without needing simultaneous knowledge of every condition in a group:
 * `tick(conditionTypes)` re-evaluates only the condition types relevant to whichever cadence
 * is calling it, persists their fresh `currentState`, and recomputes the *group's* combined
 * state by combining those fresh values with every other condition's last-stored
 * `currentState` in the same step. A step's group can freely mix condition types on
 * different cadences (e.g. PRICE_VALUE AND HIGH_IMPACT_NEWS) — each type refreshes on its
 * own schedule, but the FALSE->TRUE edge check runs every tick, on the group's current
 * combined state, from whichever cadence just changed something.
 * `engine-loop.ts` is the scheduler that calls `tick()` with the right filter at the right
 * interval; this file has no timers of its own so it stays trivially unit-testable.
 */

import {
  BaselinePriceStore,
  derivePreviousGroupState,
  evaluateCondition,
  type EvaluationContext,
} from "./condition-evaluator.js";
import type { SystemRepository } from "./repository/types.js";
import { assertValidSystemTransition } from "./state-machine.js";
import {
  attemptStep,
  recheckPendingExecution,
  DEFAULT_RECEIPT_POLL_CONFIG,
  type ReceiptPollConfig,
  type StepAttemptOutcome,
} from "./step-executor.js";
import {
  EngineError,
  type ConditionRecord,
  type ConditionType,
  type ExecutionRecord,
  type NewsDataProvider,
  type PermissionService,
  type PricePercentOrRoiParams,
  type PriceDataProvider,
  type StepModification,
  type SwapExecutor,
  type SystemRecord,
  type SystemRunRecord,
  type SystemSpec,
  type SystemSpecPatch,
  type SystemStepRecord,
  type TransactionResult,
} from "./types.js";

const PRICE_DRIVEN_TYPES: ConditionType[] = ["PRICE_VALUE", "PRICE_PERCENT", "ROI"];
const NEWS_TYPES: ConditionType[] = ["HIGH_IMPACT_NEWS"];
const TIME_TYPES: ConditionType[] = ["TIME"];

export interface UpmEngineDeps {
  repository: SystemRepository;
  priceProvider: PriceDataProvider;
  newsProvider: NewsDataProvider;
  permissionService: PermissionService;
  swapExecutor: SwapExecutor;
  baselineStore?: BaselinePriceStore;
  /** Injectable so tests don't have to wait out real multi-second/minute intervals. */
  receiptPollConfig?: ReceiptPollConfig;
}

export interface TickResult {
  systemId: string;
  triggeredStepId?: string;
  outcome?: string;
}

export class UpmEngine {
  private repository: SystemRepository;
  private priceProvider: PriceDataProvider;
  private newsProvider: NewsDataProvider;
  private permissionService: PermissionService;
  private swapExecutor: SwapExecutor;
  private baselineStore: BaselinePriceStore;
  private receiptPollConfig: ReceiptPollConfig;

  constructor(deps: UpmEngineDeps) {
    this.repository = deps.repository;
    this.priceProvider = deps.priceProvider;
    this.newsProvider = deps.newsProvider;
    this.permissionService = deps.permissionService;
    this.swapExecutor = deps.swapExecutor;
    this.baselineStore = deps.baselineStore ?? new BaselinePriceStore();
    this.receiptPollConfig = deps.receiptPollConfig ?? DEFAULT_RECEIPT_POLL_CONFIG;
  }

  // -------------------------------------------------------------------------
  // SystemEngineService
  // -------------------------------------------------------------------------

  async createSystem(walletAddress: string, spec: SystemSpec): Promise<SystemRecord> {
    // NOTE: `validateSystemSpec` (API_CONTRACT.md §8, apps/api/src/registries) is the hard
    // gate for spec shape/asset-support/capability-registry checks and runs in Part B's API
    // layer *before* this is called — this engine trusts the spec it's handed, same
    // division of responsibility API_CONTRACT.md describes for the stub it's replacing.
    const { system, steps } = await this.repository.createSystemWithSteps(
      {
        walletAddress,
        name: spec.name,
        status: "ACTIVE",
        maxAllocation: String(spec.maxAllocation),
        maxAllocationAsset: spec.maxAllocationAsset,
        expiresAt: spec.expiresAt ?? null,
        executionLimit: spec.executionLimit,
      },
      spec.steps.map((s) => ({
        groupOperator: s.groupOperator,
        conditions: s.conditions.map((c) => ({ conditionType: c.conditionType, parameters: c.parameters })),
        swap: {
          sourceAsset: s.swap.sourceAsset,
          destinationAsset: s.swap.destinationAsset,
          amountType: s.swap.amountType,
          amountValue: String(s.swap.amountValue),
          executionOrder: 0, // set below
          maxSlippageBps: s.swap.maxSlippageBps ?? 100, // doc 05 §13 / doc 06 §7 locked default
        },
      })),
    );

    // TODO(Part E): real Nexus Smart Session permission creation happens here once Part E
    // lands (API_CONTRACT.md §5's `// TODO(Part E)` markers apply to this engine too — Part
    // B's stub and this engine must not diverge on where that call belongs). Wired against
    // the mocked PermissionService for now so the call shape is proven out.
    const assets = new Set<string>();
    for (const s of steps) {
      assets.add(s.swap.sourceAsset);
      assets.add(s.swap.destinationAsset);
    }
    const permRef = await this.permissionService.createPermission({
      systemId: system.id,
      walletAddress,
      maxAllocation: system.maxAllocation,
      maxAllocationAsset: system.maxAllocationAsset,
      assets: [...assets],
      // Threaded through (Part I) so the permission layer can set a real on-chain time bound
      // instead of creating an unbounded session — see PermissionScope.expiresAt in types.ts.
      expiresAt: system.expiresAt,
    });
    await this.repository.recordPermissionCreated(system.id, {
      id: permRef.id,
      sessionReference: permRef.sessionReference,
      scope: { assets: [...assets] },
    });

    const run = await this.repository.createRun(system.id, 1);
    const firstStep = steps[0];
    if (firstStep) {
      await this.repository.updateRunCurrentStep(run.id, firstStep.step.id);
    }
    const updated = await this.repository.updateSystemCurrentRun(system.id, run.id);
    return updated;
  }

  async pauseSystem(systemId: string): Promise<SystemRecord> {
    const system = await this.mustGetSystem(systemId);
    assertValidSystemTransition(system.status, "PAUSED");
    // doc 05 §26: pause/resume does not revoke permissions or reset state — run/step/
    // condition state is left exactly as-is; only `systems.status` moves.
    return this.repository.updateSystemStatus(systemId, "PAUSED");
  }

  async resumeSystem(systemId: string): Promise<SystemRecord> {
    const system = await this.mustGetSystem(systemId);
    assertValidSystemTransition(system.status, "ACTIVE");

    if (system.status === "HALTED" && system.currentRunId) {
      const run = await this.repository.getRun(system.currentRunId);
      if (run?.currentStepId) {
        const execution = await this.repository.getExecutionForStep(run.id, run.currentStepId);
        if (execution && execution.state !== "COMPLETED") {
          // A `pending-timeout-halted` execution is distinguishable from a classified
          // retryable/non-retryable halt by exactly this combination of already-persisted
          // fields: status PENDING (never overwritten to FAILED/SUCCESS) + retryable null
          // (never classified, because it was never resolved) + a real txHash to re-check.
          // No new persisted field was needed to represent this — see `step-executor.ts`.
          const isPendingTimeout = execution.status === "PENDING" && execution.retryable === null && !!execution.txHash;

          if (isPendingTimeout) {
            // Manager-confirmed: resuming from a manual-review pending-timeout halt must
            // NOT blindly reset to WAITING and let the next tick resubmit a brand new
            // transaction — the original one might still land on-chain. Re-activate first,
            // then re-poll the SAME txHash via `recheckPendingExecution`, and let whatever
            // it decides (succeeded / retryable / non-retryable / pending again) be the
            // final word — which is why this branch returns early instead of falling
            // through to the unconditional `updateSystemStatus(..., "ACTIVE")` at the
            // bottom: that call would otherwise clobber a COMPLETE or re-HALTED status the
            // recheck just set.
            await this.repository.updateRunStatus(run.id, "ACTIVE");
            const reactivatedSystem = await this.repository.updateSystemStatus(systemId, "ACTIVE");
            const bundle = await this.repository.getStepBundle(run.currentStepId);
            if (bundle) {
              const outcome = await recheckPendingExecution(
                { repository: this.repository, swapExecutor: this.swapExecutor, permissionService: this.permissionService },
                reactivatedSystem,
                run,
                execution,
                this.receiptPollConfig,
              );
              await this.handleAttemptOutcome(reactivatedSystem, run, bundle.step, bundle.swap, outcome);
            }
            return this.mustGetSystem(systemId);
          }

          // Classified retryable/non-retryable halt: fresh attempt budget. ASSUMPTION
          // (flagging — not stated in the brief's summary of doc 04 §12, and manager-approved
          // as-is): without this, a System halted purely by hitting `executionLimit` could
          // never make forward progress again even after the user resumes, which would make
          // "resume" a no-op for that halt cause and contradict doc 04 §12 ("Resume
          // continues from the exact failed step"). Reset is scoped to *this* execution row
          // only — history (attemptCount before reset) isn't preserved distinctly today; if
          // the product wants "attempts across all resumes" capped too, that needs a second
          // counter, which is a schema change to flag back, not something to add unasked.
          await this.repository.updateExecution(execution.id, {
            state: "WAITING",
            attemptCount: 0,
            retryable: null,
            errorLog: null,
          });
        }
        if (run.status === "HALTED") {
          await this.repository.updateRunStatus(run.id, "ACTIVE");
        }
      }
      // NOTE: deliberately NOT eagerly reopening positions here. SCHEMA.md Design decision
      // #2 is explicit: "status flips back to OPEN on the *next execution* after
      // reactivation" — i.e. reopening is a side effect of the next successful fill, not of
      // the resume/reactivate call itself. `upsertPositionOnFill` (called from
      // `onStepSucceeded`) already flips CLOSED -> OPEN and clears `closedAt` on any fill, so
      // this falls out for free without a separate eager call — see `reopenPositionsForSystem`
      // on the repository port, kept available for an explicit "reopen without waiting for a
      // fill" product decision if the manager thread wants one, but unused by this engine.
    }

    return this.repository.updateSystemStatus(systemId, "ACTIVE");
  }

  async deleteSystem(systemId: string): Promise<void> {
    // Actual on-chain revocation is Part E's job (brief §12 "Actual Nexus permission calls
    // are Part E's job — this part just needs to call the permission-service interface").
    const active = await this.repository.revokeActivePermission(systemId);
    if (active) {
      await this.permissionService.revokePermission({ id: active.id, sessionReference: active.sessionReference });
    }
    await this.repository.deleteSystem(systemId);
  }

  async modifySystem(
    systemId: string,
    patch: SystemSpecPatch,
    stepModification?: StepModification,
  ): Promise<SystemRecord> {
    // doc 05 §30: "changes only the specified condition/swap, doesn't restart the current
    // run, revokes old permissions and creates new ones." Top-level field patch (name,
    // maxAllocation, ...) never touches run/step state at all — matches API_CONTRACT.md §3's
    // PATCH /systems/:id note that Part B's stub already handles those fields; this method
    // additionally takes the step-level modification API_CONTRACT.md flags as "a Part C/E
    // concern."
    if (Object.keys(patch).length > 0) {
      await this.repository.patchSystem(systemId, {
        name: patch.name,
        maxAllocation: patch.maxAllocation !== undefined ? String(patch.maxAllocation) : undefined,
        maxAllocationAsset: patch.maxAllocationAsset,
        executionLimit: patch.executionLimit,
        expiresAt: patch.expiresAt,
      });
    }

    if (stepModification) {
      if (stepModification.conditions) {
        await this.repository.replaceStepConditions(stepModification.stepId, stepModification.conditions);
        this.baselineStore.clearAll(); // conditionIds changed; stale baselines would misattribute
      }
      if (stepModification.swap) {
        await this.repository.replaceStepSwap(stepModification.stepId, {
          sourceAsset: stepModification.swap.sourceAsset,
          destinationAsset: stepModification.swap.destinationAsset,
          amountType: stepModification.swap.amountType,
          amountValue: String(stepModification.swap.amountValue),
          executionOrder: 0,
          maxSlippageBps: stepModification.swap.maxSlippageBps ?? 100,
        });
      }

      // Revoke old permission, create new one, scoped against the System's current full
      // asset set (doc 05 §30). Current run/step progress is untouched — no run/step/
      // execution calls happen in this branch.
      const system = await this.mustGetSystem(systemId);
      const revoked = await this.repository.revokeActivePermission(systemId);
      if (revoked) {
        await this.permissionService.revokePermission({ id: revoked.id, sessionReference: revoked.sessionReference });
      }
      const stepBundles = await this.repository.listStepsForSystem(systemId);
      const assets = new Set<string>();
      for (const b of stepBundles) {
        assets.add(b.swap.sourceAsset);
        assets.add(b.swap.destinationAsset);
      }
      const permRef = await this.permissionService.createPermission({
        systemId,
        walletAddress: system.walletAddress,
        maxAllocation: system.maxAllocation,
        maxAllocationAsset: system.maxAllocationAsset,
        assets: [...assets],
        expiresAt: system.expiresAt,
      });
      await this.repository.recordPermissionCreated(systemId, {
        id: permRef.id,
        sessionReference: permRef.sessionReference,
        scope: { assets: [...assets] },
      });
    }

    return this.mustGetSystem(systemId);
  }

  async reactivateSystem(systemId: string): Promise<SystemRecord> {
    const system = await this.mustGetSystem(systemId);
    if (system.status !== "COMPLETE" && system.status !== "EXPIRED") {
      throw new EngineError("CONFLICT", `Cannot reactivate a System in status ${system.status}`);
    }
    assertValidSystemTransition(system.status, "ACTIVE");

    // doc 05 §21-22, §29: new run_id, fresh execution state, Step 1, same System definition
    // + preserved history. Condition `currentState` resets to false (doc 05 §22 "no previous
    // condition-trigger state") — positions re-open (real holdings persist, doc 06 §8) but
    // cost basis/quantity are NOT reset (see positions.ts comment in full_schema.txt).
    const runNumber = (await this.repository.countRunsForSystem(systemId)) + 1;
    const run = await this.repository.createRun(systemId, runNumber);
    const stepBundles = await this.repository.listStepsForSystem(systemId);
    const firstStep = stepBundles.sort((a, b) => a.step.stepOrder - b.step.stepOrder)[0];
    if (firstStep) {
      await this.repository.updateRunCurrentStep(run.id, firstStep.step.id);
    }
    await this.repository.resetAllConditionStatesForSystem(systemId);
    this.baselineStore.clearAll();
    // Positions stay CLOSED until the new run's first successful fill reopens them — see the
    // note in `resumeSystem` above; same reasoning, same SCHEMA.md Design decision #2.
    await this.repository.updateSystemCurrentRun(systemId, run.id);
    return this.repository.updateSystemStatus(systemId, "ACTIVE");
  }

  // -------------------------------------------------------------------------
  // Expiration (brief responsibility #10 — System-level, separate from a TIME condition)
  // -------------------------------------------------------------------------

  async checkExpiration(systemId: string): Promise<boolean> {
    const system = await this.mustGetSystem(systemId);
    if (system.status !== "ACTIVE" && system.status !== "PAUSED") return false;
    if (!system.expiresAt) return false;
    if (new Date(system.expiresAt).getTime() > Date.now()) return false;

    await this.repository.updateSystemStatus(systemId, "EXPIRED");
    if (system.currentRunId) {
      await this.repository.updateRunStatus(system.currentRunId, "EXPIRED");
    }
    await this.repository.closePositionsForSystem(systemId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Evaluation tick — see cadence design note at the top of this file.
  // -------------------------------------------------------------------------

  async tickPriceDriven(): Promise<TickResult[]> {
    return this.tick(PRICE_DRIVEN_TYPES);
  }

  async tickNews(): Promise<TickResult[]> {
    return this.tick(NEWS_TYPES);
  }

  async tickTime(): Promise<TickResult[]> {
    return this.tick(TIME_TYPES);
  }

  /** Exposed directly for tests that want single-call, all-types determinism. */
  async tick(conditionTypesToRefresh: ConditionType[]): Promise<TickResult[]> {
    const results: TickResult[] = [];
    const activeSystems = await this.repository.listActiveSystems();

    for (const system of activeSystems) {
      const expired = await this.checkExpiration(system.id);
      if (expired) {
        results.push({ systemId: system.id, outcome: "expired" });
        continue;
      }
      if (!system.currentRunId) continue;

      const run = await this.repository.getRun(system.currentRunId);
      if (!run || run.status !== "ACTIVE" || !run.currentStepId) continue;

      const bundle = await this.repository.getStepBundle(run.currentStepId);
      if (!bundle) continue;

      const { step, conditions, swap } = bundle;
      const relevant = conditions.filter((c) => conditionTypesToRefresh.includes(c.conditionType));
      if (relevant.length === 0) continue;

      const prevGroupState = derivePreviousGroupState(step.groupOperator, conditions);

      const ctx = await this.buildEvaluationContext(system.id, system.walletAddress);
      const freshValues = new Map<string, boolean>();
      for (const c of relevant) {
        freshValues.set(c.id, await evaluateCondition(c, ctx));
      }
      const merged = conditions.map((c) => (freshValues.has(c.id) ? { ...c, currentState: freshValues.get(c.id)! } : c));
      const newGroupState =
        step.groupOperator === "AND" ? merged.every((c) => c.currentState) : merged.some((c) => c.currentState);

      // Persist fresh per-condition states regardless of whether the group triggers — this
      // IS the schema's stored history for next tick's edge comparison. Doc 05 §18 (now
      // available in full) is explicit and literal here: "For a waiting step: FALSE→TRUE
      // makes the condition group eligible. TRUE→TRUE does nothing. TRUE→FALSE returns the
      // step to waiting." — and separately, §18's own framing ("condition state is separate
      // from transaction execution state") is *why* that edge rule only governs a step that's
      // still WAITING (no execution row created yet this run).
      for (const [conditionId, state] of freshValues) {
        await this.repository.updateConditionState(conditionId, state);
      }

      const existingExecution = await this.repository.getExecutionForStep(run.id, step.id);

      // Two distinct triggers, matching doc 05 §18-20 precisely rather than collapsing them
      // into one rule:
      //  - No execution row yet (step is genuinely WAITING) -> governed by the strict
      //    FALSE→TRUE edge above. TRUE→TRUE and TRUE→FALSE on a still-WAITING step are both
      //    correctly no-ops here (TRUE→FALSE just never sets `shouldAttempt`, matching
      //    "returns the step to waiting" — there's nothing else to undo since no execution
      //    was ever created).
      //  - Execution row exists and isn't COMPLETED (EXECUTING after a retryable failure, or
      //    WAITING again after a resume-reset) -> this is doc 05 §24's "retry the same
      //    transaction according to the retry policy" / doc 04 §12's "resume continues from
      //    the exact failed step," which is retry-policy-governed, not condition-edge-gated
      //    (§18's edge rule is scoped to "a waiting step," and a step with an open execution
      //    row is no longer definitionally waiting even if its `state` value happens to say
      //    WAITING post-reset). Retries proceed every tick regardless of the group's
      //    from-this-tick value — the COMPLETED guard is what still enforces "a completed
      //    execution cannot create another transaction during the same run" (doc 05 §20).
      const shouldAttempt = existingExecution
        ? existingExecution.state !== "COMPLETED"
        : !prevGroupState && newGroupState;

      if (shouldAttempt) {
        const outcome = await attemptStep(
          { repository: this.repository, swapExecutor: this.swapExecutor, permissionService: this.permissionService },
          system,
          run,
          step,
          swap,
          this.receiptPollConfig,
        );
        results.push({ systemId: system.id, triggeredStepId: step.id, outcome: outcome.kind });
        await this.handleAttemptOutcome(system, run, step, swap, outcome);
      }
    }

    return results;
  }

  /**
   * Shared by `tick()`'s first-attempt path and `resumeSystem()`'s pending-timeout recheck
   * path, so both react identically to "succeeded" / "halted for any reason" outcomes
   * instead of maintaining two copies of this branching.
   */
  private async handleAttemptOutcome(
    system: SystemRecord,
    run: SystemRunRecord,
    step: SystemStepRecord,
    swap: { sourceAsset: string; destinationAsset: string },
    outcome: StepAttemptOutcome,
  ): Promise<void> {
    if (outcome.kind === "succeeded") {
      await this.onStepSucceeded(system, run, step, swap, outcome.execution, outcome.receipt);
    } else if (
      outcome.kind === "limit-reached-halted" ||
      outcome.kind === "failed-non-retryable-halted" ||
      outcome.kind === "pending-timeout-halted" ||
      outcome.kind === "no-active-permission-halted"
    ) {
      // doc 06 §8: "A position is closed when the System is completed, halted, or
      // expired" — HALTED is explicitly one of the three closing triggers, alongside
      // COMPLETE (handled in onStepSucceeded) and EXPIRED (handled in checkExpiration).
      // A pending-timeout halt is still a HALT (System status HALTED either way, see
      // `step-executor.ts`), so it closes positions the same as any other halt cause.
      await this.repository.closePositionsForSystem(system.id);
    }
  }

  private async onStepSucceeded(
    system: SystemRecord,
    run: SystemRunRecord,
    step: SystemStepRecord,
    swap: { sourceAsset: string; destinationAsset: string },
    execution: ExecutionRecord,
    receipt: TransactionResult,
  ): Promise<void> {
    // Balance reconciliation (doc 05 §16, manager-confirmed as an engine-level change): record
    // what ACTUALLY happened on-chain, not the pre-submission quote. `amountIn`/`amountOut` come
    // off the receipt the executor reconciled from the last hop's Swap event.
    //
    // Previously both of these were hardcoded to "1" because the mock executor returned no fill
    // data, which silently fabricated every cost basis and therefore every ROI evaluation.
    //
    // If the executor could not reconcile amounts (either field absent), the position is
    // deliberately left untouched rather than updated with an invented quantity — a missing
    // reconciliation is a real condition worth seeing in the data, and a fabricated cost basis is
    // strictly worse than an un-updated one. The transaction row is still written either way so
    // the Activity screen reflects the swap, with nulls making the gap visible.
    const amountIn = receipt.amountIn ?? null;
    const amountOut = receipt.amountOut ?? null;

    if (amountIn !== null && amountOut !== null) {
      await this.repository.upsertPositionOnFill({
        walletAddress: system.walletAddress,
        systemId: system.id,
        assetId: swap.destinationAsset,
        filledQuantity: amountOut,
        filledCostInQuoteAsset: amountIn,
      });
    }

    await this.repository.recordTransaction({
      walletAddress: system.walletAddress,
      source: "SYSTEM",
      // Linked now (was null): `transactions.execution_id` is what joins an Activity row back to
      // the execution that produced it, and the schema has the column.
      executionId: execution.id,
      systemId: system.id,
      txHash: execution.txHash,
      status: (execution.status as "SUCCESS") ?? "SUCCESS",
      sourceAsset: swap.sourceAsset,
      destinationAsset: swap.destinationAsset,
      amountIn,
      amountOut,
      blockNumber: receipt.blockNumber ?? null,
    });

    const allSteps = await this.repository.listStepsForSystem(system.id);
    const next = allSteps.find((s) => s.step.stepOrder === step.stepOrder + 1);

    if (next) {
      await this.repository.updateRunCurrentStep(run.id, next.step.id);
      // RATCHET (manager-confirmed): the next step's PRICE_PERCENT condition(s) get their
      // baseline explicitly reset to the price *at this successful execution*, rather than
      // left to the lazy first-evaluation default. Doc 01 §1's own example ("buys $10 worth
      // of AAPL every time it drops 5%, until I own $50 worth") only behaves as described if
      // each subsequent -5% is measured from the previous buy's price, not from a single
      // fixed reference — a fixed baseline would only ever fire once per approach to that
      // one original price. `BaselinePriceStore.set` is the unconditional overwrite (as
      // opposed to `.getOrSet`, still used for a condition's genuine first-ever evaluation).
      for (const cond of next.conditions) {
        if (cond.conditionType !== "PRICE_PERCENT") continue;
        const params = cond.parameters as PricePercentOrRoiParams;
        const snapshot = await this.priceProvider.getCurrentPrice(params.asset);
        if (!snapshot.isStale) {
          this.baselineStore.set(cond.id, snapshot.price);
        }
      }
      return;
    }

    // No more steps — run and System complete (brief walkthrough: "... next step eligible →
    // completion").
    await this.repository.updateRunStatus(run.id, "COMPLETE");
    await this.repository.updateSystemStatus(system.id, "COMPLETE");
    await this.repository.closePositionsForSystem(system.id);
  }

  private async buildEvaluationContext(systemId: string, walletAddress: string): Promise<EvaluationContext> {
    return {
      priceProvider: this.priceProvider,
      newsProvider: this.newsProvider,
      timezone: await this.repository.getUserTimezone(walletAddress),
      getPositionForRoi: async (assetId: string) => {
        // Kept here (not in condition-evaluator.ts) so the evaluator module stays
        // persistence-agnostic; ROI reads the System's own position via the repository port.
        const pos = await this.repository.getPosition(systemId, assetId);
        if (!pos) return null;
        return { costBasis: Number(pos.costBasis), quantity: Number(pos.quantity) };
      },
      getOrSetPricePercentBaseline: (conditionId, currentPrice) =>
        this.baselineStore.getOrSet(conditionId, currentPrice),
    };
  }

  private async mustGetSystem(systemId: string): Promise<SystemRecord> {
    const system = await this.repository.getSystem(systemId);
    if (!system) throw new EngineError("NOT_FOUND", `System ${systemId} not found`);
    return system;
  }
}

export { BaselinePriceStore } from "./condition-evaluator.js";