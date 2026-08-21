import { z } from "zod";

/**
 * POST /transactions/prepare — doc 02 "One-off transactions", step 2 ("AI prepares the
 * transaction"). Same validate-don't-execute pattern as POST /systems/validate: this
 * produces the structured object the Chat UI renders as the Approve/Cancel template
 * (doc 02 step 3-5) — it never submits anything itself. Actually signing/submitting is a
 * separate, later endpoint (not built yet — this only covers "prepare").
 *
 * `amountAsset` denotes which asset `amount` is denominated in — must be either
 * `sourceAsset` or `destinationAsset` (validated server-side, not just by this shape).
 */
export const prepareTransactionRequestSchema = z.object({
  sourceAsset: z.string().min(1),
  destinationAsset: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/, "expected a positive decimal string"),
  amountAsset: z.string().min(1),
});
export type PrepareTransactionRequest = z.infer<typeof prepareTransactionRequestSchema>;

export const prepareTransactionResponseSchema = z.object({
  transactionId: z.string(),
  sourceAsset: z.string(),
  destinationAsset: z.string(),
  amount: z.string(),
  /**
   * A non-binding preview figure only — mid-price from `asset_prices`, no slippage/fee/
   * liquidity modeling (that's Part F's QuickSwap routing engine's job at actual execution
   * time). The backend never commits to executing at this figure.
   */
  estimatedOutput: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type PrepareTransactionResponse = z.infer<typeof prepareTransactionResponseSchema>;