import { z } from "zod";
import { assetRegistryEntrySchema } from "./registry-entries.js";

/** GET /portfolio — doc 01 §14 Home screen: holdings + portfolio value. RWA assets only (doc 06 §2). */
export const portfolioHoldingSchema = z.object({
  asset: assetRegistryEntrySchema,
  quantity: z.string(), // decimal as string
  costBasis: z.string(),
  currentValue: z.string(),
});
export type PortfolioHolding = z.infer<typeof portfolioHoldingSchema>;

export const portfolioResponseSchema = z.object({
  holdings: z.array(portfolioHoldingSchema),
  totalValue: z.string(),
  /**
   * Stablecoin balance held by the wallet, reported SEPARATELY from `holdings`.
   *
   * doc 06 §2 locks Home's holdings list to "RWA assets only", so tUSDG must not appear there — but a
   * portfolio that shows $0 while the wallet holds 10 USDG reads as broken to a user, and there was no
   * field in this contract that could carry it. Optional so existing consumers are unaffected; a client
   * that does not render cash simply ignores it.
   */
  cashBalance: z.string().optional(),
});
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

/** GET /positions — doc 06 §8. */
export const positionResponseSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  assetId: z.string(),
  status: z.enum(["OPEN", "CLOSED"]),
  costBasis: z.string(),
  quantity: z.string(),
  currentValue: z.string(),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type PositionResponse = z.infer<typeof positionResponseSchema>;

/** GET /activity — doc 06 §6, paginated. */
export const transactionResponseSchema = z.object({
  id: z.string(),
  source: z.enum(["SYSTEM", "ONE_OFF"]),
  systemId: z.string().nullable(),
  txHash: z.string().nullable(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]),
  sourceAsset: z.string(),
  destinationAsset: z.string(),
  amountIn: z.string().nullable(),
  amountOut: z.string().nullable(),
  timestamp: z.string().datetime(),
});
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;

export const paginatedActivityResponseSchema = z.object({
  items: z.array(transactionResponseSchema),
  nextCursor: z.string().nullable(),
});
export type PaginatedActivityResponse = z.infer<typeof paginatedActivityResponseSchema>;

/** GET/PATCH /settings — doc 06 §7. Memory on/off lives on memory_summary, surfaced here too. */
export const settingsResponseSchema = z.object({
  timezone: z.string(),
  maxSlippageDefaultBps: z.number().int(),
  memoryEnabled: z.boolean(),
});
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;

export const patchSettingsRequestSchema = z
  .object({
    timezone: z.string().optional(),
    maxSlippageDefaultBps: z.number().int().min(1).max(10_000).optional(),
    memoryEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field must be provided" });
export type PatchSettingsRequest = z.infer<typeof patchSettingsRequestSchema>;

/** GET /high-impact-news — must be shown to the user before creating a news-based System (doc 02). */
export const highImpactNewsEventSchema = z.object({
  id: z.string(),
  event: z.string(),
  eventTimestamp: z.string().datetime(),
  country: z.string(),
  eventType: z.string(),
  impactLevel: z.string(),
  sourceUrl: z.string().nullable(),
});
export type HighImpactNewsEvent = z.infer<typeof highImpactNewsEventSchema>;
