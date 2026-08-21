import { createPublicClient, fallback, http, type PublicClient } from "viem";
import {
  UNISWAP_V2_PAIR_ABI,
  ERC20_ABI,
  type ChainReader,
} from "@oplier/amm-execution";
import { xLayerTestnet } from "@oplier/permissions";

/**
 * Real `ChainReader` — the viem implementation of the read-only chain access
 * `@oplier/amm-execution` declares but deliberately does not implement (that package has zero
 * runtime dependency on viem so it can unit-test with no registry access; its README states the
 * real wiring belongs in `apps/worker`).
 *
 * Reserves come straight from the Pair contract, and `token0` is read alongside them because V2
 * pairs sort their tokens by address — the quoting layer needs to know which side is which to
 * orient the constant-product math correctly.
 *
 * NOT YET RUN AGAINST A LIVE RPC.
 */

export interface ViemChainReaderDeps {
  rpcUrl: string;
  /** Second official OKX endpoint. Both are interchangeable, so `fallback` is straightforward. */
  fallbackRpcUrl?: string;
  chainId: number;
}

/**
 * Transport tuning for the X Layer testnet endpoints, which are materially slower and flakier than
 * viem's defaults assume.
 *
 * WHY: viem's `http` defaults to a 10s timeout. Measured against `testrpc.xlayer.tech/terigon`, a
 * bare `eth_chainId` takes ~2.7s when the endpoint is healthy, so 10s leaves very little headroom —
 * and under the concurrent `readContract` load the AMM preflight generates, calls were exceeding it.
 * A timeout is not a dead endpoint, but `fallback` treats it as one: it moved on to
 * `xlayertestrpc.okx.com/terigon`, which currently accepts the connection and never responds at all,
 * turning a recoverable blip into an ~81s hard `worker_start_aborted`. Observed exactly that.
 *
 * `retryCount` is left at viem's default 3; the fix is per-attempt patience, not more attempts.
 */
const RPC_HTTP_OPTS = { timeout: 30_000 } as const;

export function createChainClient(deps: ViemChainReaderDeps): PublicClient {
  const transports = [http(deps.rpcUrl, RPC_HTTP_OPTS)];
  if (deps.fallbackRpcUrl) transports.push(http(deps.fallbackRpcUrl, RPC_HTTP_OPTS));
  return createPublicClient({
    // `xLayerTestnet` is defined once in @oplier/permissions (chain id 1952, confirmed against
    // both OKX's and Alchemy's own pages) — redefining it here would be a second source of truth.
    chain: deps.chainId === xLayerTestnet.id ? xLayerTestnet : { ...xLayerTestnet, id: deps.chainId },
    transport: transports.length > 1 ? fallback(transports) : transports[0]!,
  });
}

export class ViemChainReader implements ChainReader {
  constructor(private readonly client: PublicClient) {}

  async getReserves(pairAddress: string): Promise<{
    reserve0: bigint;
    reserve1: bigint;
    token0: string;
    token1: string;
  }> {
    const address = pairAddress as `0x${string}`;
    const [reserves, token0, token1] = await Promise.all([
      this.client.readContract({
        address,
        abi: UNISWAP_V2_PAIR_ABI,
        functionName: "getReserves",
      }) as Promise<readonly [bigint, bigint, number]>,
      this.client.readContract({ address, abi: UNISWAP_V2_PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
      this.client.readContract({ address, abi: UNISWAP_V2_PAIR_ABI, functionName: "token1" }) as Promise<`0x${string}`>,
    ]);
    return {
      reserve0: reserves[0],
      reserve1: reserves[1],
      token0,
      token1,
    };
  }

  async getBalance(token: string, owner: string): Promise<bigint> {
    return (await this.client.readContract({
      address: token as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner as `0x${string}`],
    })) as bigint;
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.client.getBlockNumber());
  }
}
