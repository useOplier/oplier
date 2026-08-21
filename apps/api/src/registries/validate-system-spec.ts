import { ZodError } from "zod";
import { systemSpecSchema, type SystemSpec } from "@oplier/shared-types";
import type { AssetRegistryService } from "./asset-registry.service.js";
import type { CapabilityRegistryService } from "./capability-registry.service.js";

export interface SystemSpecValidationIssue {
  path: string;
  message: string;
}

export type ValidateSystemSpecResult =
  | { valid: true; spec: SystemSpec }
  | { valid: false; issues: SystemSpecValidationIssue[] };

/**
 * THE single source-of-truth validator (Part B brief §3: "Do not let two different validation
 * implementations exist — this function is the one and only gate"). Part C's execution engine
 * and Part G's LLM tool layer must both call this rather than re-implementing any part of it.
 *
 * Deliberately returns a Result rather than throwing (brief's literal signature:
 * `validateSystemSpec(spec): Result<ValidSystem, ValidationError[]>`), so a caller like
 * POST /systems/validate can show the user every problem at once instead of one at a time.
 *
 * Validation order, all issues collected rather than failing fast on the first one (doc 04 §18
 * lists these as a checklist, not an early-exit sequence):
 *  1. Structural shape (Zod) — types, required fields, decimal string formats.
 *  2. Every condition_type used is supported by the currently active capability_registry
 *     version (doc 02 "Systems": "Unsupported requests are not silently changed, approximated,
 *     or worked around").
 *  3. Every amount_type used is supported by the same.
 *  4. Every asset referenced (maxAllocationAsset, each swap's source/destination) exists, is
 *     available in the current environment, and supports the required action — via
 *     AssetRegistryService, the OTHER hard gate (doc 01 §8).
 *  5. Each swap's (source, destination) pair is a supported trading pair.
 *  6. step_order values are unique (doc 04 §4 — ordered steps; a duplicate would also violate
 *     the DB's own unique constraint on (system_id, step_order), so this is a friendlier
 *     pre-check, not new business logic).
 *  7. expiresAt, if set, is in the future (doc 04 §13).
 */
export async function validateSystemSpec(
  rawSpec: unknown,
  deps: {
    capabilityRegistry: CapabilityRegistryService;
    assetRegistry: AssetRegistryService;
  },
): Promise<ValidateSystemSpecResult> {
  const issues: SystemSpecValidationIssue[] = [];

  const parsed = systemSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    return { valid: false, issues: zodIssuesToValidationIssues(parsed.error) };
  }
  const spec = parsed.data;

  const capability = await deps.capabilityRegistry.getActive();
  const supportedConditionTypes = new Set(Object.keys(capability.conditionTypes));
  const supportedAmountTypes = new Set(Object.keys(capability.swapAmountTypes));

  // #6 step_order uniqueness
  const seenStepOrders = new Set<number>();
  for (const step of spec.steps) {
    if (seenStepOrders.has(step.stepOrder)) {
      issues.push({
        path: `steps[stepOrder=${step.stepOrder}]`,
        message: `Duplicate stepOrder ${step.stepOrder} — step orders must be unique within a System.`,
      });
    }
    seenStepOrders.add(step.stepOrder);
  }

  // #2/#3 capability checks, per step
  for (const [stepIdx, step] of spec.steps.entries()) {
    for (const condition of step.conditions) {
      if (!supportedConditionTypes.has(condition.conditionType)) {
        issues.push({
          path: `steps[${stepIdx}].conditions`,
          message: `Condition type "${condition.conditionType}" is not supported by capability_registry v${capability.version}.`,
        });
      }
    }
    if (!supportedAmountTypes.has(step.swap.amountType)) {
      issues.push({
        path: `steps[${stepIdx}].swap.amountType`,
        message: `Amount type "${step.swap.amountType}" is not supported by capability_registry v${capability.version}.`,
      });
    }
  }

  // #4/#5 asset checks — collect issues rather than letting the first ApiError abort validation
  await checkAsset(deps.assetRegistry, spec.maxAllocationAsset, undefined, "maxAllocationAsset", issues);
  for (const [stepIdx, step] of spec.steps.entries()) {
    const path = `steps[${stepIdx}].swap`;
    const sourceOk = await checkAsset(deps.assetRegistry, step.swap.sourceAsset, "SELL", `${path}.sourceAsset`, issues);
    const destOk = await checkAsset(deps.assetRegistry, step.swap.destinationAsset, "BUY", `${path}.destinationAsset`, issues);
    if (sourceOk && destOk) {
      try {
        await deps.assetRegistry.validateTradingPair(step.swap.sourceAsset, step.swap.destinationAsset);
      } catch (err) {
        issues.push({ path, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // #7 expiration must be in the future
  if (spec.expiresAt && new Date(spec.expiresAt).getTime() <= Date.now()) {
    issues.push({ path: "expiresAt", message: "expiresAt must be in the future." });
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }
  return { valid: true, spec };
}

async function checkAsset(
  assetRegistry: AssetRegistryService,
  assetId: string,
  requiredAction: string | undefined,
  path: string,
  issues: SystemSpecValidationIssue[],
): Promise<boolean> {
  try {
    await assetRegistry.validateAsset(assetId, requiredAction);
    return true;
  } catch (err) {
    issues.push({ path, message: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function zodIssuesToValidationIssues(error: ZodError): SystemSpecValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
