import { z } from "zod";
import { conditionSpecSchema } from "./condition-params.js";

/**
 * `swaps.amount_type` — exact enum values from Part A's real schema
 * (packages/db/src/schema/enums.ts): FIXED | CURRENT_BALANCE_PERCENT | SYSTEM_START_BALANCE_PERCENT
 * (doc 04 §6 — three MVP amount primitives).
 */
export const amountTypeSchema = z.enum([
  "FIXED",
  "CURRENT_BALANCE_PERCENT",
  "SYSTEM_START_BALANCE_PERCENT",
]);
export type AmountType = z.infer<typeof amountTypeSchema>;

export const swapSpecSchema = z.object({
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amountType: amountTypeSchema,
  /**
   * Decimal transported as a string (never a JS number) to avoid float precision loss on an
   * amount that controls real money movement. Meaning depends on amountType: absolute token
   * amount for FIXED, percentage (0, 100] for the two percentage types.
   */
  amountValue: z.string().regex(/^\d+(\.\d+)?$/, "expected a positive decimal string"),
  executionOrder: z.number().int().nonnegative(),
  maxSlippageBps: z.number().int().min(1).max(10_000).default(100),
});
export type SwapSpec = z.infer<typeof swapSpecSchema>;

export const groupOperatorSchema = z.enum(["AND", "OR"]);

/**
 * One step: a flat AND/OR group of conditions (doc 05 §34, no nesting in MVP) + exactly one
 * swap (doc 04 §4-5, enforced at the DB level by `swaps.stepId` being unique).
 */
export const systemStepSpecSchema = z.object({
  stepOrder: z.number().int().nonnegative(),
  groupOperator: groupOperatorSchema.default("AND"),
  conditions: z.array(conditionSpecSchema).min(1),
  swap: swapSpecSchema,
});
export type SystemStepSpec = z.infer<typeof systemStepSpecSchema>;

/**
 * The structured shape LLM #1 (Part G) produces from natural language and this backend
 * validates (doc 04 §3 "Natural Language → System"). This is the single input shape
 * `validateSystemSpec()` accepts — see registries/validate-system-spec.ts.
 *
 * `maxAllocation`/`maxAllocationAsset` are mandatory, explicit user input — never guessed,
 * never derived from Memory (doc 02, doc 03 LLM #1 "cannot use Memory as a System max
 * allocation"). This type does not enforce "the caller actually typed this" — that's a
 * process/UX guarantee the Chat flow must uphold; the type only enforces presence and shape.
 *
 * `executionLimit`: manager-locked semantic — caps repeated firing (retry attempts, tracked via
 * `executions.attemptCount`) of the same step within a run. See RECONCILIATION notes in
 * API_CONTRACT.md — Part A's schema is compatible with this reading but doesn't itself encode
 * it; Part C's engine must implement the cap.
 */
export const systemSpecSchema = z.object({
  name: z.string().min(1).max(200),
  maxAllocation: z.string().regex(/^\d+(\.\d+)?$/, "expected a positive decimal string"),
  maxAllocationAsset: z.string().min(1),
  executionLimit: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable().default(null),
  steps: z.array(systemStepSpecSchema).min(1),
});
export type SystemSpec = z.infer<typeof systemSpecSchema>;

/**
 * `systems.status` — exact enum values from Part A's real schema. DELETED is not a value.
 * AUTHORIZATION_REQUIRED means "validated and persisted, but no on-chain Smart Session permission
 * granted yet" — see the note on `systemStatusEnum` in packages/db/src/schema/enums.ts. Keep this
 * list in sync with that pgEnum; they are the same enum on either side of the DB boundary.
 */
export const systemStatusSchema = z.enum([
  "ACTIVE",
  "PAUSED",
  "HALTED",
  "EXPIRED",
  "COMPLETE",
  "AUTHORIZATION_REQUIRED",
]);
export type SystemStatus = z.infer<typeof systemStatusSchema>;
