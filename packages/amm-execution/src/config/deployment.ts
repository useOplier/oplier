/**
 * Real deployed contract addresses from Part K (`TOKEN_DEPLOYMENT.md`, generated from
 * `deployments/xLayerTestnet.json` as of 2026-08-18T11:44:04.169Z).
 *
 * NO PLACEHOLDERS. Every address below is copied verbatim from the attached
 * `TOKEN_DEPLOYMENT.md`. If Part K reseeds a pool or `deployments/xLayerTestnet.json` changes,
 * regenerate this file from that JSON rather than hand-editing — same rule the source doc
 * states for itself.
 *
 * This file is the single source of truth for addresses in this package — nothing else in
 * `src/` hardcodes an address.
 */

export const CHAIN = {
  name: "X Layer testnet",
  chainId: 1952,
  chainIdHex: "0x7A0",
} as const;

/** Deployer / treasury wallet — owner of the mint function on all 4 mock RWA tokens. */
export const TREASURY_ADDRESS = "0x4F0826977eF073a66B61C9cD3008519C72392df9" as const;

export const AMM_CORE = {
  weth9: "0xeB4448ED1FA53C4c1b75E3AbAa2EC4ff9F9259Fb",
  factory: "0xc6d2AC7810CDEC37674078b04F85afB41F9db481",
  router: "0x80A90e3123cB073cCA547edF90C25B912D02B40c",
  /**
   * `UniswapV2Pair` init code hash for this compilation — recorded here for reference only.
   * This package never computes pair addresses off-chain via CREATE2; it reads pool addresses
   * directly from `POOLS` below (which Part K already resolved on-chain), so this constant is
   * not consumed anywhere in `src/`. Kept for parity with the source doc / future off-chain
   * address derivation if ever needed.
   */
  pairInitCodeHash: "0xd86eb2ed06f31b98dcc0e70cf72d57487df2d2519fc4752d987f462bb3735687",
} as const;

export type PoolStatus = "SEEDED" | "EMPTY";

export interface PoolConfig {
  /** assetId of the non-USDG side of the pool (see config/assets.ts). */
  assetId: string;
  pairAddress: `0x${string}` | string;
  status: PoolStatus;
}

/**
 * The 4 direct-to-USDG pools Part K created. Status here drives the routing layer's
 * pre-submission liquidity check (see routing/resolve-route.ts) — this is deliberately static
 * config, not a live on-chain read on every swap, because Part F's brief explicitly frames
 * "created, empty" as Part K's current on-record state for 3 of the 4 pools. A live
 * `getReserves` check still happens per-swap in the quoting step (quoting/quote.ts) as the
 * authoritative gate; this table is the fast-path / documentation-level source of truth and
 * should be kept in sync with `deployments/xLayerTestnet.json` as Part K seeds more pools.
 */
export const POOLS: Record<string, PoolConfig> = {
  test_aapl: {
    assetId: "test_aapl",
    pairAddress: "0xA485B84a645dF5a6efD043425261b94a54cbeB7f",
    status: "SEEDED",
  },
  test_gold: {
    assetId: "test_gold",
    pairAddress: "0xa676f468696EEd80CBc44A3C644e851AC9b3e4a1",
    status: "EMPTY",
  },
  test_meta: {
    assetId: "test_meta",
    pairAddress: "0x59eE33856AdbedCF52fe1bFdE2AE64039e690b89",
    status: "EMPTY",
  },
  test_nvda: {
    assetId: "test_nvda",
    pairAddress: "0x54dA4ADd0BC5439d4ec8Dc25fc1AC72D75215FF0",
    status: "EMPTY",
  },
};

/** Standard V2 fixed fee — 0.3%, expressed as basis points on the *input* amount. */
export const V2_FEE_BPS = 30;
export const BPS_DENOMINATOR = 10_000;
