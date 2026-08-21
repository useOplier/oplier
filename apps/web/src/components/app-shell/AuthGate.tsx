"use client";

import { useAuthStore } from "@/store/useAuthStore";
import { Wordmark } from "@/components/landing/Wordmark";
import { ConnectWalletButton } from "./ConnectWalletButton";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-paper px-6 text-center">
        <Wordmark height={34} />
        <div>
          <h1 className="text-lg font-semibold text-ink">Connect your wallet</h1>
          <p className="mt-1.5 max-w-xs text-sm text-slate">
            Oplier is wallet-only, connect and sign in to view your portfolio.
          </p>
        </div>
        <ConnectWalletButton />
      </div>
    );
  }

  return <>{children}</>;
}
