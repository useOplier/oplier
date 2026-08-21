import type { FastifyInstance } from "fastify";
import {
  prepareTransactionRequestSchema,
  prepareTransactionResponseSchema,
  ApiError,
} from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";
import { AssetRegistryService } from "../../registries/asset-registry.service.js";
import { estimateOutput } from "./price-estimate.js";
import { createPreparedTransaction, consumePreparedTransaction } from "./prepared-transaction-store.js";
import { executeOneOffSwap } from "./one-off-swap-executor.js";
import { transactions } from "@oplier/db";

/**
 * doc 02 "One-off transactions" — the full lifecycle:
 *   POST /transactions/prepare        — steps 1-2: validate + quote, nothing submitted. The
 *                                       response is what the Chat UI renders as the
 *                                       Approve/Cancel template (steps 3-5).
 *   POST /transactions/:id/approve    — steps 6-9: executes the approved swap on-chain
 *                                       (see one-off-swap-executor.ts for the execution
 *                                       identity and safety gates).
 */
export default async function transactionsRoutes(fastify: FastifyInstance): Promise<void> {
  // TESTNET only for the hackathon MVP — same hardcoded-environment TODO as
  // modules/systems/routes.ts and modules/portfolio/routes.ts, see API_CONTRACT.md §7.
  const assetRegistry = new AssetRegistryService(fastify.db, "TESTNET");

  fastify.post("/transactions/prepare", { preHandler: requireAuth }, async (request, reply) => {
    const body = prepareTransactionRequestSchema.parse(request.body);
    const walletAddress = request.user!.walletAddress;

    // Hard gate: both assets must exist, be available, and form a supported trading pair —
    // the same asset-registry gate a System's swap step goes through (doc 01 §8). Accepts
    // symbols or asset_ids; returns the canonical registry entries.
    const { source, destination } = await assetRegistry.validateTradingPair(
      body.sourceAsset,
      body.destinationAsset,
    );

    if (body.amountAsset !== body.sourceAsset && body.amountAsset !== body.destinationAsset) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `amountAsset must be either sourceAsset ("${body.sourceAsset}") or destinationAsset ("${body.destinationAsset}").`,
      );
    }

    // Price lookups key on ASSET_IDS — pass the resolved ids, not the raw user input.
    const amountAssetEntry = body.amountAsset === body.sourceAsset ? source : destination;
    const estimatedOutput = await estimateOutput(fastify.db, {
      amount: body.amount,
      amountAssetId: amountAssetEntry.assetId,
      destinationAssetId: destination.assetId,
    });

    const { transactionId, expiresInSeconds } = createPreparedTransaction({
      walletAddress,
      sourceAsset: body.sourceAsset,
      destinationAsset: body.destinationAsset,
      amount: body.amount,
      amountAsset: body.amountAsset,
      estimatedOutput,
    });

    reply.send(
      prepareTransactionResponseSchema.parse({
        transactionId,
        sourceAsset: body.sourceAsset,
        destinationAsset: body.destinationAsset,
        amount: body.amount,
        estimatedOutput,
        expiresInSeconds,
      }),
    );
  });

  /**
   * doc 02 "One-off transactions" steps 6-9 — executes an APPROVED prepared swap on-chain.
   * The in-chat approval IS the authorization (the chat flow only reaches here after the user
   * explicitly confirmed); execution identity and rationale live in one-off-swap-executor.ts's
   * header. Synchronous by design: the chat turn that calls this reports the REAL outcome
   * (tx hash / revert) rather than a maybe. The prepared entry is consumed atomically, so a
   * second approve of the same id is a 404, not a double-spend.
   */
  fastify.post("/transactions/:id/approve", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const walletAddress = request.user!.walletAddress;

    const prepared = consumePreparedTransaction(id);
    if (!prepared) {
      throw new ApiError("NOT_FOUND", "No pending prepared transaction with this id (already approved, cancelled, or expired).");
    }
    if (prepared.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      // Consume-on-read already removed it; fail loudly rather than executing someone else's trade.
      throw new ApiError("FORBIDDEN", "This prepared transaction belongs to a different wallet.");
    }

    const assetRegistry = new AssetRegistryService(fastify.db, "TESTNET");
    const source = await assetRegistry.validateAsset(prepared.sourceAsset, "SELL");
    const destination = await assetRegistry.validateAsset(prepared.destinationAsset, "BUY");

    // MVP default slippage (doc 06 §7: 1%) — same value GET /settings reports; there is no
    // per-transaction slippage override in the tool schema yet.
    const maxSlippageBps = 100;

    const result = await executeOneOffSwap({
      source: {
        assetId: source.assetId,
        symbol: source.symbol,
        tokenAddress: source.tokenAddress,
        decimals: source.decimals,
      },
      destination: {
        assetId: destination.assetId,
        symbol: destination.symbol,
        tokenAddress: destination.tokenAddress,
        decimals: destination.decimals,
      },
      amount: prepared.amount,
      recipient: walletAddress,
      maxSlippageBps,
    });

    // Durable Activity-screen record (doc 06 §6). amountOut is the QUOTE, not a decoded receipt
    // figure — labelled as such in the response so nothing downstream treats it as exact.
    await fastify.db.insert(transactions).values({
      walletAddress,
      source: "ONE_OFF",
      txHash: result.txHash || null,
      status: result.status === "SUCCESS" ? "SUCCESS" : "FAILED",
      blockNumber: result.blockNumber,
      sourceAsset: source.assetId,
      destinationAsset: destination.assetId,
      amountIn: prepared.amount,
      amountOut: result.status === "SUCCESS" ? result.quotedOutput : null,
    });

    reply.send({
      transactionId: id,
      status: result.status,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      sourceAsset: source.symbol,
      destinationAsset: destination.symbol,
      amountIn: prepared.amount,
      estimatedOutput: result.quotedOutput,
      note:
        result.status === "SUCCESS"
          ? "Executed on-chain. amountOut is the quoted estimate; the exact filled amount may differ slightly."
          : result.error ?? "Execution failed.",
    });
  });
}
