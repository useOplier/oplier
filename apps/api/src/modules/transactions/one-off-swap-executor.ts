import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
  formatUnits,
  type PublicClient,
} from "viem";
import { defineChain } from "viem";
import { alchemy, defineAlchemyChain } from "@account-kit/infra";

/**
 * X Layer testnet for Account Kit — IDENTICAL to packages/permissions/src/chain.ts's
 * `xLayerTestnet` (same base def + same defineAlchemyChain wrapper). Duplicated rather than
 * imported because apps/api doesn't depend on @oplier/permissions; if you change one, change
 * both. WHY THE WRAPPER: createSmartWalletClient's zod validator requires
 * `rpcUrls.alchemy.http[0]`, which viem/chains' xLayerTestnet lacks ("chain must include an
 * alchemy rpc url" — seen live on the first approve attempt).
 */
const xLayerTestnet = defineAlchemyChain({
  chain: defineChain({
    id: 1952,
    name: "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: {
      default: {
        http: ["https://xlayer-testnet.g.alchemy.com/v2"],
        webSocket: ["wss://xlayer-testnet.g.alchemy.com/v2"],
      },
    },
    blockExplorers: {
      default: { name: "OKLink", url: "https://www.oklink.com/x-layer-testnet" },
    },
    testnet: true,
  }),
  rpcBaseUrl: "https://xlayer-testnet.g.alchemy.com/v2",
});
import { createSmartWalletClient, signPreparedCalls } from "@account-kit/wallet-client";
import { LocalAccountSigner } from "@aa-sdk/core";
import {
  AMM_CORE,
  UNISWAP_V2_ROUTER_ABI,
  UNISWAP_V2_PAIR_ABI,
  ERC20_ABI,
  quoteAmountsOut,
  computeAmountOutMin,
  resolveRoute,
  type ChainReader,
} from "@oplier/amm-execution";
import { loadEnv } from "../../config/env.js";

/**
 * Executes APPROVED one-off (chat) swaps on-chain.
 *
 * EXECUTION IDENTITY — deliberate MVP decision, matching the System-swap architecture: the swap
 * is submitted from the backend-owned smart account (the same account/key hierarchy the worker
 * uses; SMART_ACCOUNT_OWNER_PRIVATE_KEY owns it, Alchemy's bundler relays, the account pays its
 * own gas — sponsorship is bypassed repo-wide, do not re-enable here). The user's in-chat
 * approval is the authorization; swap OUTPUT is delivered to the requesting user's wallet, so
 * their portfolio (which reads on-chain balances) reflects the trade. A user-signed plain-EOA
 * flow needs per-wallet router allowances + gas + frontend signing UX that don't exist yet;
 * this reuses the one proven path.
 *
 * OWNER AUTHORITY, NO SESSION PERMISSION: unlike System swaps (session-key scoped), the owner
 * signer submits directly — `prepareCalls` WITHOUT the `permissions` capability, signed by the
 * owner signer. Same bundler pipeline, no permission grant needed.
 *
 * Flow: route (amm-execution) → quote off live reserves → amountOutMin from slippage → fresh
 * re-quote gate → ensure router allowance (approve userop if short) → swap userop → poll
 * getCallsStatus for the receipt. Fail-closed everywhere: no fabricated success.
 */

const CALLS_STATUS = {
  /** 100-1xx: received/queued/in-flight — not yet resolved on-chain. */
  PENDING_MAX: 199,
  /** 200: included on-chain without reverts. */
  CONFIRMED: 200,
} as const;

const RECEIPT_POLL_INTERVAL_MS = 3_000;
const RECEIPT_MAX_WAIT_MS = 120_000;

/** Narrow shape of the SDK client actually used — mirrors session-key-sender.ts's seam so the
 * SDK's broad generics don't leak into this module (and it stays unit-testable). */
interface MinimalWalletClient {
  prepareCalls(args: unknown): Promise<unknown>;
  sendPreparedCalls(args: unknown): Promise<{ id: string }>;
  getCallsStatus(id: string): Promise<{
    status: number;
    receipts?: Array<{ transactionHash: string; status: string; blockNumber: string | number; logs: unknown[] }>;
  }>;
  requestAccount(): Promise<{ address: string }>;
}

export interface OneOffSwapArgs {
  /** Registry entries for both sides (symbol-resolved upstream). */
  source: { assetId: string; symbol: string; tokenAddress: string; decimals: number };
  destination: { assetId: string; symbol: string; tokenAddress: string; decimals: number };
  /** Human decimal amount of the SOURCE asset, e.g. "1.00". */
  amount: string;
  /** Where the OUTPUT tokens are delivered — the requesting user's wallet. */
  recipient: string;
  maxSlippageBps: number;
}

export interface OneOffSwapResult {
  status: "SUCCESS" | "FAILED";
  txHash: string;
  blockNumber: number | null;
  /** Quoted output in human decimals (the receipt's Swap event isn't decoded in the MVP). */
  quotedOutput: string;
  error?: string;
}

class OneOffSwapStack {
  readonly publicClient: PublicClient;
  private readonly client: MinimalWalletClient;
  private readonly ownerSigner: LocalAccountSigner<never>;
  private ownerSmartAccount: string | null = null;

  constructor() {
    const env = loadEnv();
    if (!env.ALCHEMY_API_KEY || !env.SMART_ACCOUNT_OWNER_PRIVATE_KEY) {
      throw Object.assign(
        new Error(
          "Transaction execution is not configured (ALCHEMY_API_KEY / SMART_ACCOUNT_OWNER_PRIVATE_KEY missing).",
        ),
        { code: "EXECUTION_UNAVAILABLE" },
      );
    }
    this.publicClient = createPublicClient({ chain: xLayerTestnet, transport: http(env.XLAYER_RPC_URL) });
    this.ownerSigner = LocalAccountSigner.privateKeyToAccountSigner(
      env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`,
    ) as LocalAccountSigner<never>;
    const raw = createSmartWalletClient({
      transport: alchemy({ apiKey: env.ALCHEMY_API_KEY }),
      chain: xLayerTestnet,
      signer: this.ownerSigner as never,
    });
    this.client = raw as unknown as MinimalWalletClient;
  }

  private async resolveOwnerSmartAccount(): Promise<string> {
    if (this.ownerSmartAccount) return this.ownerSmartAccount;
    // `requestAccount()` takes no signer argument — the signer is already bound to the client —
    // and returns a `SmartContractAccount` whose address is `.address` (same as runtime.ts).
    const account = await this.client.requestAccount();
    this.ownerSmartAccount = account.address;
    return this.ownerSmartAccount;
  }

  /** Owner-authority submit: no session permission capability, owner signer. Returns bundle id. */
  private async submit(to: string, data: string): Promise<string> {
    const from = await this.resolveOwnerSmartAccount();
    const prepared = await this.client.prepareCalls({
      calls: [{ to, data }],
      from,
    });
    const signed = await signPreparedCalls(this.ownerSigner as never, prepared as never);
    const { id } = await this.client.sendPreparedCalls(signed);
    return id;
  }

  private async waitForReceipt(
    bundleId: string,
  ): Promise<{ status: "success" | "reverted"; txHash: string; blockNumber: number } | null> {
    const deadline = Date.now() + RECEIPT_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
      let status: Awaited<ReturnType<MinimalWalletClient["getCallsStatus"]>>;
      try {
        status = await this.client.getCallsStatus(bundleId);
      } catch {
        continue; // transient lookup failure — keep polling until the deadline
      }
      if (status.status <= CALLS_STATUS.PENDING_MAX) continue;
      const receipt = status.receipts?.[0];
      if (!receipt) {
        // Resolved off-chain (400/410) — the bundle never landed.
        return { status: "reverted", txHash: "", blockNumber: 0 };
      }
      const succeeded = status.status === CALLS_STATUS.CONFIRMED && BigInt(receipt.status) === 1n;
      return {
        status: succeeded ? "success" : "reverted",
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
      };
    }
    return null; // timed out — report honestly rather than guessing
  }

  private chainReader(): ChainReader {
    const pc = this.publicClient;
    return {
      async getReserves(pairAddress: string) {
        const reserves = (await pc.readContract({
          address: pairAddress as `0x${string}`,
          abi: UNISWAP_V2_PAIR_ABI,
          functionName: "getReserves",
        })) as readonly [bigint, bigint, number];
        const [token0, token1] = (await Promise.all([
          pc.readContract({ address: pairAddress as `0x${string}`, abi: UNISWAP_V2_PAIR_ABI, functionName: "token0" }),
          pc.readContract({ address: pairAddress as `0x${string}`, abi: UNISWAP_V2_PAIR_ABI, functionName: "token1" }),
        ])) as [string, string];
        return { reserve0: reserves[0], reserve1: reserves[1], token0, token1 };
      },
      async getBalance(token: string, owner: string) {
        return (await pc.readContract({
          address: token as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [owner as `0x${string}`],
        })) as bigint;
      },
      async getBlockNumber() {
        return Number(await pc.getBlockNumber());
      },
    };
  }

  async execute(args: OneOffSwapArgs): Promise<OneOffSwapResult> {
    const ownerSmartAccount = await this.resolveOwnerSmartAccount();

    // Route + quote off live pool reserves — the same amm-execution code the worker's System
    // swaps run through.
    const route = resolveRoute(args.source.assetId, args.destination.assetId);
    const reader = this.chainReader();

    const amountIn = parseUnits(args.amount, args.source.decimals);

    const amounts = await quoteAmountsOut(reader, route, amountIn);
    const quotedOut = amounts[amounts.length - 1];
    const amountOutMin = computeAmountOutMin(quotedOut, args.maxSlippageBps);

    // Fresh re-quote immediately before submission — the same anti-stale gate the System
    // executor runs. Never auto-widens the limit if this fails.
    const fresh = await quoteAmountsOut(reader, route, amountIn);
    const freshOut = fresh[fresh.length - 1];
    if (freshOut < amountOutMin) {
      throw Object.assign(
        new Error(
          `Price moved before submission: fresh quote ${formatUnits(freshOut, args.destination.decimals)} is below the ${args.maxSlippageBps}bps minimum ${formatUnits(amountOutMin, args.destination.decimals)}.`,
        ),
        { code: "SLIPPAGE_EXCEEDED" },
      );
    }

    // Allowance: the Router pulls the source token from the smart account via transferFrom.
    const allowance = (await this.publicClient.readContract({
      address: args.source.tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [ownerSmartAccount as `0x${string}`, AMM_CORE.router],
    })) as bigint;
    if (allowance < amountIn) {
      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [AMM_CORE.router, amountIn],
      });
      const approveBundle = await this.submit(args.source.tokenAddress, approveData);
      const approveReceipt = await this.waitForReceipt(approveBundle);
      if (!approveReceipt || approveReceipt.status !== "success") {
        throw Object.assign(new Error("Router allowance approval failed on-chain."), { code: "APPROVAL_FAILED" });
      }
    }

    const deadline = BigInt(Math.floor((Date.now() + 10 * 60 * 1000) / 1000));
    const swapData = encodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, amountOutMin, route.addressPath as `0x${string}`[], args.recipient as `0x${string}`, deadline],
    });

    const bundleId = await this.submit(AMM_CORE.router, swapData);
    const receipt = await this.waitForReceipt(bundleId);

    if (!receipt) {
      return {
        status: "FAILED",
        txHash: bundleId,
        blockNumber: null,
        quotedOutput: formatUnits(quotedOut, args.destination.decimals),
        error: "Swap submission timed out waiting for the receipt — check the Activity screen for the final state.",
      };
    }

    return {
      status: receipt.status === "success" ? "SUCCESS" : "FAILED",
      txHash: receipt.txHash || bundleId,
      blockNumber: receipt.blockNumber || null,
      quotedOutput: formatUnits(quotedOut, args.destination.decimals),
      ...(receipt.status === "success" ? {} : { error: "Swap reverted on-chain." }),
    };
  }
}

let stack: OneOffSwapStack | null = null;

function getStack(): OneOffSwapStack {
  if (!stack) stack = new OneOffSwapStack();
  return stack;
}

export function executeOneOffSwap(args: OneOffSwapArgs): Promise<OneOffSwapResult> {
  return getStack().execute(args);
}