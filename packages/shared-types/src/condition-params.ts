import { z } from "zod";

/**
 * Per-condition-type parameter shapes. Sourced directly from Part A's real
 * `packages/db/src/seed.ts` capability_registry v1 seed data — NOT guessed. That seed data is
 * itself the human-readable param *description* seeded into the DB; these Zod schemas are
 * Part B's typed, validating mirror of the same contract, used to validate `conditions.parameters`
 * before it's ever written.
 *
 * If Part A/J ever re-seed capability_registry with a different shape, these schemas need to be
 * updated to match — capability_registry's `conditionTypes` JSONB is the runtime source of
 * truth; this file is a compile-time-checked copy of it for Part B/G's convenience.
 */

const assetIdSchema = z.string().min(1);

export const priceValueParamsSchema = z.object({
  asset: assetIdSchema,
  operator: z.enum(["EQ", "GT", "LT"]),
  value: z.string(), // decimal, transported as string to avoid float precision loss
});
export type PriceValueParams = z.infer<typeof priceValueParamsSchema>;

export const pricePercentParamsSchema = z.object({
  asset: assetIdSchema,
  direction: z.enum(["UP", "DOWN"]),
  percent: z.string(), // decimal (0-100]
});
export type PricePercentParams = z.infer<typeof pricePercentParamsSchema>;

export const roiParamsSchema = z.object({
  asset: assetIdSchema,
  direction: z.enum(["UP", "DOWN"]),
  percent: z.string(), // decimal (0-100]
});
export type RoiParams = z.infer<typeof roiParamsSchema>;

/**
 * TIME: doc 04 §2 lists `if date = DD/MM/YYYY` and `if time = HH:MM` as separate primitives;
 * Part A's seed.ts models them as a single condition_type with two optional fields
 * (`date: "YYYY-MM-DD | null"`, `time: "HH:MM | null"`). Preserved exactly as seeded — not
 * reinterpreted into two separate condition types.
 */
export const timeParamsSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
      .nullable(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "expected HH:MM")
      .nullable(),
  })
  .refine((v) => v.date !== null || v.time !== null, {
    message: "at least one of date/time must be set",
  });
export type TimeParams = z.infer<typeof timeParamsSchema>;

/** HIGH_IMPACT_NEWS: seed.ts locks this to exactly two values — 1 or 24 hours. */
export const highImpactNewsParamsSchema = z.object({
  withinHours: z.union([z.literal(1), z.literal(24)]),
});
export type HighImpactNewsParams = z.infer<typeof highImpactNewsParamsSchema>;

/**
 * Discriminated union over `conditions.parameters`, keyed the same way as the DB's
 * `condition_type` enum (packages/db/src/schema/enums.ts). Use `conditionSpecSchema.parse(...)`
 * anywhere a condition is being constructed from a request or an LLM tool call.
 */
export const conditionSpecSchema = z.discriminatedUnion("conditionType", [
  z.object({ conditionType: z.literal("PRICE_VALUE"), parameters: priceValueParamsSchema }),
  z.object({ conditionType: z.literal("PRICE_PERCENT"), parameters: pricePercentParamsSchema }),
  z.object({ conditionType: z.literal("ROI"), parameters: roiParamsSchema }),
  z.object({ conditionType: z.literal("TIME"), parameters: timeParamsSchema }),
  z.object({
    conditionType: z.literal("HIGH_IMPACT_NEWS"),
    parameters: highImpactNewsParamsSchema,
  }),
]);
export type ConditionSpec = z.infer<typeof conditionSpecSchema>;
export type ConditionType = ConditionSpec["conditionType"];
