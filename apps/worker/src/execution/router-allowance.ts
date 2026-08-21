import { createPublicClient, encodeFunctionData, http, type PublicClient } from "viem";
import { ERC20_ABI, AMM_CORE, getTokenConfig } from "@oplier/amm-execution";
import { xLayerTestnet } from "@oplier/permissions";
import type { Logger } from "../lib/logger.js";
import { OWNER_PERMISSION_REF } from "../permissions/on-chain-revoker.js";

/**
 * Ensures the smart account has granted the AMM Router an ERC-20 allowance for a swap's source token.
 *
 * WHY THIS EXISTS: nothing in the swap path ever called `approve`. `swapExactTokensForTokens` does a
 * `transferFrom` on the source token, so without an allowance every swap reverts — and the only reason
 * swaps worked at all was a standing allowance set by hand, outside the code, on one account. That is
 * not a fix: a fresh deployment, a new smart account, or a different source token has no allowance and
 * fails with no explanation of why.
 *
 * WHY THE OWNER SIGNS THIS, NOT THE SESSION KEY. The System's session key is deliberately scoped to
 * exactly one function on exactly one contract (`swapExactTokensForTokens` on the Router — see the
 * granted permission's `scopedContract`/`scopedFunction`). Widening that scope to include `approve` on
 * token contracts would be a real privilege escalation: `approve` takes an arbitrary spender, so a
 * leaked session key could authorise any address to move the account's tokens, which is strictly worse
 * than what the key can do today (swap along a fixed route, up to a spend limit). Approvals are
 * therefore submitted under owner authority via `OWNER_PERMISSION_REF` — the same sentinel the
 * revoker uses — and the session key's scope stays minimal.
 *
 * IDEMPOTENT BY DESIGN: reads the current allowance first and returns without submitting anything when
 * it already suffices. In steady state this costs one `eth_call` per swap and no transaction.
 */

export interface AllowanceEnsurerDeps {
  rpcUrl: string;
  chainId: number;
  logger: Logger;
  /**
   * Submits under owner authority when handed `OWNER_PERMISSION_REF`. Structurally the same sender the
   * swap path uses, so approvals go through the same bundler/gas configuration as everything else.
   */
  send(params: { to: string; data: string; permissionRef: string }): Promise<{ txHash: string }>;
}

export class RouterAllowanceEnsurer {
  private readonly client: PublicClient;
  private readonly logger: Logger;

  constructor(private readonly deps: AllowanceEnsurerDeps) {
    this.logger = deps.logger.child({ component: "allowance" });
    this.client = createPublicClient({
      chain:
        deps.chainId === xLayerTestnet.id ? xLayerTestnet : { ...xLayerTestnet, id: deps.chainId },
      transport: http(deps.rpcUrl, { timeout: 30_000 }),
    });
  }

  /**
   * Guarantees `allowance(accountAddress -> Router) >= requiredAmount` for `assetId`'s token.
   *
   * `approvalAmount` is what gets approved when a top-up is needed, and callers should pass a bounded
   * figure (the System's max allocation), NOT an unlimited approval. An infinite allowance on a
   * long-lived account is exactly the standing-allowance risk this replaces; bounding it means a
   * Router compromise is capped at what the System was ever authorised to trade.
   *
   * Returns the approval's txHash when one was submitted, or null when the existing allowance was
   * already sufficient.
   */
  async ensure(args: {
    assetId: string;
    accountAddress: string;
    requiredAmount: bigint;
    approvalAmount: bigint;
    systemId: string;
  }): Promise<string | null> {
    const token = getTokenConfig(args.assetId);
    if (!token) {
      // Unknown source asset is the caller's problem, not something to paper over by skipping the
      // allowance check — the swap itself will fail route resolution for the same reason.
      throw new Error(`ensureAllowance: no token config for asset "${args.assetId}"`);
    }

    const current = (await this.client.readContract({
      address: token.tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [args.accountAddress as `0x${string}`, AMM_CORE.router as `0x${string}`],
    })) as bigint;

    if (current >= args.requiredAmount) return null;

    if (args.approvalAmount < args.requiredAmount) {
      // Approving less than the swap needs would just move the revert one step later, with a more
      // confusing message. Fail loudly on the misconfiguration instead.
      throw new Error(
        `ensureAllowance: approvalAmount ${args.approvalAmount} is below requiredAmount ` +
          `${args.requiredAmount} for ${args.assetId} — the swap could not succeed even after approving`,
      );
    }

    this.logger.warn("allowance_topping_up", {
      systemId: args.systemId,
      assetId: args.assetId,
      token: token.tokenAddress,
      spender: AMM_CORE.router,
      current: current.toString(),
      required: args.requiredAmount.toString(),
      approving: args.approvalAmount.toString(),
      detail: "submitting an owner-authorised approve; the session key is not scoped for this",
    });

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [AMM_CORE.router as `0x${string}`, args.approvalAmount],
    });

    const { txHash } = await this.deps.send({
      to: token.tokenAddress,
      data,
      permissionRef: OWNER_PERMISSION_REF,
    });

    this.logger.info("allowance_approved", {
      systemId: args.systemId,
      assetId: args.assetId,
      txHash,
      approved: args.approvalAmount.toString(),
    });
    return txHash;
  }
}
