import { z } from "zod";
import { systemSpecSchema, systemStatusSchema } from "./system-spec.js";

/** GET /systems list item (doc 06 §4: name/id, status, active/inactive card colour). */
export const systemSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: systemStatusSchema,
  maxAllocation: z.string(),
  maxAllocationAsset: z.string(),
  createdAt: z.string().datetime(),
});
export type SystemSummary = z.infer<typeof systemSummarySchema>;

export const systemsListResponseSchema = z.object({
  items: z.array(systemSummarySchema),
});
export type SystemsListResponse = z.infer<typeof systemsListResponseSchema>;

/** One row from `executions`, as shown in System Detail's execution log (doc 06 §5). */
export const executionLogEntrySchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  state: z.enum(["WAITING", "EXECUTING", "COMPLETED"]),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]).nullable(),
  retryable: z.boolean().nullable(),
  errorLog: z.string().nullable(),
  attemptCount: z.number().int(),
  txHash: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExecutionLogEntry = z.infer<typeof executionLogEntrySchema>;

/** GET /systems/:id — doc 06 §5: full config + execution logs below it. */
export const systemDetailResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: systemStatusSchema,
  spec: systemSpecSchema,
  currentRunId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  executions: z.array(executionLogEntrySchema),
});
export type SystemDetailResponse = z.infer<typeof systemDetailResponseSchema>;

/**
 * POST /systems/validate response — NOT in Part B brief's literal endpoint list. Added so a
 * System can be shown to the user for review (doc 02 "System is shown to the user" step)
 * before anything is persisted, given Nexus/authorization (Part E) doesn't exist yet to gate
 * real persistence on. See API_CONTRACT.md "Known stub limitations" for the full reasoning.
 */
export const validateSystemResponseSchema = z.object({
  valid: z.literal(true),
  spec: systemSpecSchema,
});
export type ValidateSystemResponse = z.infer<typeof validateSystemResponseSchema>;

/** POST /systems request body — the raw spec to validate and (if valid) persist. */
export const createSystemRequestSchema = systemSpecSchema;
export type CreateSystemRequest = z.infer<typeof createSystemRequestSchema>;

export const createSystemResponseSchema = z.object({
  id: z.string(),
  status: systemStatusSchema,
});
export type CreateSystemResponse = z.infer<typeof createSystemResponseSchema>;

/**
 * PATCH /systems/:id request body — partial modification (doc 04 §15).
 *
 * `expiresAt` is re-declared instead of inherited from `systemSpecSchema.partial()`. Zod's
 * `.partial()` makes a key optional but does NOT strip its `.default()`, and `systemSpecSchema`
 * declares `expiresAt: ...nullable().default(null)`. So a plain `.partial()` produced a schema where
 * EVERY parsed body carried `expiresAt: null` whether or not the caller sent it — `{ name: "x" }`
 * parsed to `{ name: "x", expiresAt: null }`.
 *
 * That silently broke two things, verified against the running API:
 *   1. Any PATCH cleared the System's expiry, because the engine reads `spec.expiresAt !== undefined`
 *      as "the caller set this" and wrote null. Renaming a System wiped its expiration date.
 *   2. Once modification became permission-aware, every PATCH looked permission-relevant and forced
 *      a needless re-authorization (a fresh on-chain session key) for something as trivial as a rename.
 *
 * Declared `.optional()` without a default, so absent means absent and an explicit `null` still
 * clears the expiry — which is the distinction the engine's partial-update logic depends on.
 */
export const modifySystemRequestSchema = systemSpecSchema
  .omit({ expiresAt: true })
  .partial()
  .extend({ expiresAt: z.string().datetime().nullable().optional() });
export type ModifySystemRequest = z.infer<typeof modifySystemRequestSchema>;
