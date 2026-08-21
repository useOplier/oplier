import { defineChain } from "viem";
import { defineAlchemyChain } from "@account-kit/infra";

/**
 * X Layer Testnet — chain ID confirmed directly against Alchemy's chain resource page
 * (https://www.alchemy.com/rpc/xlayer-testnet) at build time: 1952 / 0x7A0. See FINDINGS.md
 * §1 — this matches the master plan's flagged value, the "195" seen on some third-party
 * sites appears to be a stale/confused reference to mainnet's chain ID (196), not testnet's.
 *
 * RPC/WS URLs below are Alchemy's own X Layer testnet endpoints (same host pattern Alchemy
 * uses for every chain: `<chain>-testnet.g.alchemy.com`). Pull the OKX-official RPC too and
 * cross-check before mainnet — same standing caveat as everywhere else in this project that
 * touches X Layer.
 */
export const X_LAYER_TESTNET_CHAIN_ID = 1952;
export const X_LAYER_MAINNET_CHAIN_ID = 196; // NOT used yet — flagged here so it's not confused
// with testnet's 1952 when mainnet work eventually starts. Re-verify against OKX's official
// docs directly before ever using this for a real deployment (master-plan standing caveat).

const xLayerTestnetBase = defineChain({
  id: X_LAYER_TESTNET_CHAIN_ID,
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
});

/**
 * The chain Account Kit is actually given.
 *
 * WHY THE WRAPPER: `createSmartWalletClient` runs the chain through Alchemy's own zod validator,
 * which reads `rpcUrls.alchemy.http[0]` specifically and rejects the chain outright with "chain must
 * include an alchemy rpc url" if that key is absent. The base definition above put Alchemy's URL in
 * `rpcUrls.default` — correct URL, wrong slot — so the client threw at construction and, because
 * `buildRuntime` builds it eagerly, the WORKER COULD NOT START AT ALL. Preflight has its own entry
 * point that never touches Account Kit, which is why it passed while the worker did not.
 *
 * `defineAlchemyChain` is Alchemy's supported way to add that key for a chain they serve RPC for but
 * do not ship a built-in definition of. X Layer is not in `@account-kit/infra`'s 55 built-in chains,
 * but `https://xlayer-testnet.g.alchemy.com/v2/<key>` does answer `eth_chainId` with 0x7a0 (verified
 * 2026-08-19), so RPC support is real even though the chain constant is missing.
 *
 * STILL UNVERIFIED, and this wrapper does NOT settle it: whether Alchemy's smart-account, gas-manager
 * and session-key features work on chain 1952. That is FINDINGS.md §3's open item. This only gets the
 * client past construction so those calls can actually be attempted and give a real answer.
 */
export const xLayerTestnet = defineAlchemyChain({
  chain: xLayerTestnetBase,
  rpcBaseUrl: "https://xlayer-testnet.g.alchemy.com/v2",
});

/**
 * AMM Router address — the contract this package scopes session keys against.
 *
 * Confirmed by Part K: **`0x80A90e3123cB073cCA547edF90C25B912D02B40c`**, and it's a **Uniswap
 * V2** router, not the V3-style router this file originally assumed (QuickSwap V3 doesn't
 * apply here — corrected below). Doc 02 still wants the session key scoped to a specific
 * contract/function, and this is still the only contract every System's swaps actually go
 * through (SCHEMA.md: the System only records intended asset flow, "the backend routing
 * engine resolves the actual path... at execution time" — individual pool addresses vary per
 * swap, the router entry point doesn't), so it's still a fixed, package-level constant rather
 * than a per-call input. Unlike the gas manager policy id below (account-specific, genuinely
 * secret), this is a public, fixed, now-confirmed contract address — hardcoded here like
 * `X_LAYER_TESTNET_CHAIN_ID`, with an env override available for pointing tests or a future
 * chain at a different router without touching this file.
 */
export const AMM_ROUTER_ADDRESS_XLAYER_TESTNET = "0x80A90e3123cB073cCA547edF90C25B912D02B40c";

export function resolveAmmRouterAddress(env = process.env): string {
  return env.AMM_ROUTER_ADDRESS_OVERRIDE ?? AMM_ROUTER_ADDRESS_XLAYER_TESTNET;
}

/**
 * Function selector(s) the session key permits on the router above.
 *
 * CORRECTED per Part K: the router is Uniswap V2, not V3 — there's no `exactInputSingle`,
 * `exactInput`, or `multicall` (those are V3-only). V2's standard token-to-token swap entry
 * point is `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`, which is
 * what every MVP System swap (RWA-token ⇄ USDG, both ERC-20) needs — scoped to that single
 * selector rather than the three-selector V3 guess this file previously had.
 *
 * Deliberately NOT included, flagged rather than silently assumed unnecessary: V2's
 * ETH-denominated variants (`swapExactETHForTokens` / `swapExactTokensForETH`) and the
 * fee-on-transfer-safe variants (`swapExactTokensForTokensSupportingFeeOnTransferTokens` etc.)
 * — this package has no signal any MVP System needs a native-asset leg or fee-on-transfer RWA
 * tokens, so it doesn't widen the allowlist speculatively. Add them here (and re-derive
 * `contractAllowlist` scoping if a second contract is ever involved) if that changes.
 */
export const AMM_ROUTER_FUNCTION_SELECTORS = [
  "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
] as const;

/**
 * Gas Manager policy id — the manually-created dashboard policy referenced in the brief.
 * Read from env so this package never hardcodes a secret/id; Part I supplies it at wiring
 * time. Kept here (not buried in alchemy-permission-service.ts) since it's chain-scoped
 * config, same category as the chain definition above.
 */
export function requireGasManagerPolicyId(env = process.env): string {
  const policyId = env.ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET;
  if (!policyId) {
    throw new Error(
      "ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET is not set — this must be the policy id " +
        "from the dashboard-created sponsorship policy referenced in the Part E brief, not a " +
        "new one created programmatically (brief: \"integrate that same capability " +
        "programmatically, not recreate it from scratch\").",
    );
  }
  return policyId;
}
