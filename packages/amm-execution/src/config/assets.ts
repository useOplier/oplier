/**
 * assetId -> on-chain token config, for the assets this package routes swaps between.
 *
 * `assetId` values for the 4 mock RWA tokens are copied verbatim from `TOKEN_DEPLOYMENT.md`'s
 * "Asset ID" column (`test_aapl`, `test_gold`, `test_meta`, `test_nvda`) — these match
 * `asset_registry.asset_id` per `full_schema.txt`'s doc comment ("a stable human-readable slug
 * ... used as the primary key"), so `SwapExecutor.executeSwap`'s `sourceAsset`/`destinationAsset`
 * (which the engine passes as `asset_registry.asset_id` values, per ENGINE_CONTRACT.md) resolve
 * directly against this table.
 *
 * USDG's assetId is `"test_usdg"` — confirmed directly from the real database, not a guess
 * (an earlier draft of this file guessed `"usdg"`, following the apparent no-`test_`-prefix
 * convention since USDG is a real token rather than a mock one; that guess was wrong).
 */
export const USDG_ASSET_ID = "test_usdg";

export interface TokenConfig {
  assetId: string;
  symbol: string;
  tokenAddress: `0x${string}` | string;
  decimals: number;
}

/** The 4 mock RWA tokens, addresses verbatim from `TOKEN_DEPLOYMENT.md` §1. */
export const RWA_TOKENS: Record<string, TokenConfig> = {
  test_aapl: {
    assetId: "test_aapl",
    symbol: "AAPLx",
    tokenAddress: "0x3b5AF698A5F684AC723Ac2501B9183e875bFFd4A",
    decimals: 18,
  },
  test_gold: {
    assetId: "test_gold",
    symbol: "GLDx",
    tokenAddress: "0xf6dF132E97351D90c5792F1b763082F598cC3988",
    decimals: 18,
  },
  test_meta: {
    assetId: "test_meta",
    symbol: "METAx",
    tokenAddress: "0xE9f6B8264adE8F010EA3F80082542C545dd65808",
    decimals: 18,
  },
  test_nvda: {
    assetId: "test_nvda",
    symbol: "NVDAx",
    tokenAddress: "0xE7F5486861C7C1cEE138e5b350f6BdfE68309A4C",
    decimals: 18,
  },
};

/**
 * USDG — real Paxos-issued testnet token (not one of Part K's deployments), address verbatim
 * from `TOKEN_DEPLOYMENT.md` §1. 6 decimals, distinct from the RWA tokens' 18.
 */
export const USDG_TOKEN: TokenConfig = {
  assetId: USDG_ASSET_ID,
  symbol: "USDG",
  tokenAddress: "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1",
  decimals: 6,
};

export const ASSETS: Record<string, TokenConfig> = {
  ...RWA_TOKENS,
  [USDG_ASSET_ID]: USDG_TOKEN,
};

export function getTokenConfig(assetId: string): TokenConfig | undefined {
  return ASSETS[assetId];
}

export function isUsdg(assetId: string): boolean {
  return assetId === USDG_ASSET_ID;
}
