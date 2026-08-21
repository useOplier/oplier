"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/useAuthStore";
import { signInWithEthereum } from "@/lib/auth";

/**
 * Ceiling on how long to wait for the wallet to answer the signature request.
 *
 * WHY THIS EXISTS: `signingIn` was cleared ONLY by the sign-in promise settling, so any wallet that
 * never answers left the button reading "Signing in…" forever — no error, no retry, nothing to click.
 * Observed live: `POST /auth/nonce` returned 200, no `/auth/verify` ever followed, and the UI sat
 * stuck for 5+ minutes; the only escape was navigating away and starting over, which a real user has
 * no reason to think of. A wallet that goes unanswered is normal (popup dismissed, popup suppressed,
 * extension hiccup), so this has to be a handled state rather than an assumed-impossible one.
 */
const SIGNATURE_TIMEOUT_MS = 90_000;

/**
 * Once wagmi reports a connected address, this fires the SIWE flow
 * automatically (RainbowKit connect → sign nonce → session) per
 * 08_PART_H_frontend.md "Auth/wallet flow" — the person only has to approve
 * the connection and the one signature, no separate "sign in" click.
 */
export function ConnectWalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { isAuthenticated, walletAddress, clearSession } = useAuthStore();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the Retry button to re-run the effect deliberately. */
  const [attempt, setAttempt] = useState(0);

  /**
   * `signMessageAsync` is held in a ref rather than listed as a dependency.
   *
   * WHY: wagmi does not guarantee a stable function identity across renders. As a dependency it could
   * re-run this effect mid-flight, whose cleanup sets `cancelled = true` — which suppresses the
   * in-flight attempt's own `.catch`/`.finally`, so its loading state is never cleared and its failure
   * is never shown, while a duplicate signature request goes out to the wallet. Wallets typically drop
   * the duplicate, leaving nothing to settle and the UI latched on "Signing in…" permanently.
   */
  const signMessageRef = useRef(signMessageAsync);
  signMessageRef.current = signMessageAsync;

  useEffect(() => {
    if (!isConnected || !address || !chainId) return;
    if (isAuthenticated && walletAddress?.toLowerCase() === address.toLowerCase()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSigningIn(true);
    setError(null);

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Wallet didn't respond. Retry to sign in.")),
        SIGNATURE_TIMEOUT_MS,
      );
    });

    Promise.race([
      signInWithEthereum(address, chainId, (args) => signMessageRef.current(args)),
      timeout,
    ])
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Sign-in failed");
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        if (!cancelled) setSigningIn(false);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // signMessageAsync deliberately excluded — see signMessageRef above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, chainId, isAuthenticated, walletAddress, attempt]);

  useEffect(() => {
    if (!isConnected) clearSession();
  }, [isConnected, clearSession]);

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) return <div className="h-9 w-28" aria-hidden />;

        if (!connected) {
          return (
            <Button size="sm" onClick={openConnectModal}>
              Connect Wallet
            </Button>
          );
        }

        return (
          <div className="flex items-center gap-2">
            {signingIn && <span className="text-xs text-slate">Signing in…</span>}
            {error && !signingIn && (
              <>
                <span className="text-xs text-danger">{error}</span>
                {/* Without this the only way out of a failed sign-in was to navigate away and come
                    back, which no user would think to try. */}
                <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={openAccountModal}>
              {account.displayName}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
