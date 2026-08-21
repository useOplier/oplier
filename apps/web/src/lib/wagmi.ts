import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { okxWallet, metaMaskWallet, walletConnectWallet, rainbowWallet } from "@rainbow-me/rainbowkit/wallets";
import { defineChain } from "viem";

/**
 * X Layer testnet. Confirmed against OKX's official RPC endpoints doc
 * (chain-id 0x7A0 / 1952 decimal). Two known-good endpoints are listed as
 * fallbacks; NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL can still override the
 * primary if a different one is preferred.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL ?? "https://testrpc.xlayer.tech/terigon",
        "https://xlayertestrpc.okx.com/terigon",
      ],
    },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer-test" },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "Oplier",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "oplier-dev-placeholder",
  chains: [xLayerTestnet],
  wallets: [
    {
      groupName: "Recommended",
      // OKX Wallet listed first — X Layer is an OKX-ecosystem chain (doc 08 / brief).
      wallets: [okxWallet, metaMaskWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  ssr: true,
});
