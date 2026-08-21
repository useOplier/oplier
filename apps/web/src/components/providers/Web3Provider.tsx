"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import { QueryProvider } from "./QueryProvider";

// RainbowKit modal themed to the locked brand palette rather than its default.
const oplierRainbowTheme = lightTheme({
  accentColor: "#63D678",
  accentColorForeground: "#0B0B0C",
  borderRadius: "medium",
  fontStack: "system",
});

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryProvider>
        <RainbowKitProvider theme={oplierRainbowTheme}>{children}</RainbowKitProvider>
      </QueryProvider>
    </WagmiProvider>
  );
}
