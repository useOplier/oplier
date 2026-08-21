import { SiweMessage } from "siwe";
import { requestNonce, verifySiwe } from "./api/client";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * RainbowKit connect → SIWE sign-in per 08_PART_H_frontend.md "Auth/wallet
 * flow". Called after wagmi reports a connected address; `signMessageAsync`
 * is passed in from the caller's `useSignMessage()` hook so this stays a
 * plain function rather than a hook itself.
 */
/**
 * De-duplicates concurrent sign-ins for the same wallet+chain.
 *
 * THE BUG THIS FIXES: nonces are SINGLE-USE and consumed before verification
 * (`apps/api/src/auth/siwe.ts` — `consumeNonce` runs before `.verify()`), and `next.config.mjs` sets
 * `reactStrictMode: true`, which deliberately double-invokes effects in development. So the sign-in
 * effect fired twice, fetched TWO different nonces, and started two concurrent `signMessage` calls.
 * The wallet surfaces a single prompt, so one of those closures ends up calling `/auth/verify` with a
 * message whose nonce was already burned by the other — or with a signature that does not match its
 * own message. Either way the API answers 401, the browser holds no access token, and every
 * subsequent request throws `ApiError` from `realFetch`. That presented as "new chat is broken" and
 * "portfolio won't read" when in fact the whole session was simply unauthenticated.
 *
 * Module-level rather than a ref on purpose: Strict Mode unmounts and remounts the component, which
 * discards refs — the guard has to outlive the component to be effective. Keyed by wallet+chain so a
 * genuine account or network switch is never suppressed, and cleared on settle so a failed attempt can
 * be retried.
 */
const inFlightByKey = new Map<string, Promise<void>>();

export async function signInWithEthereum(
  walletAddress: string,
  chainId: number,
  signMessageAsync: (args: { message: string }) => Promise<string>
): Promise<void> {
  const key = `${walletAddress.toLowerCase()}:${chainId}`;
  const existing = inFlightByKey.get(key);
  // Await the in-flight attempt rather than returning immediately, so callers still resolve only once
  // the session actually exists (or reject with the same error).
  if (existing) return existing;

  const attempt = performSignIn(walletAddress, chainId, signMessageAsync).finally(() => {
    inFlightByKey.delete(key);
  });
  inFlightByKey.set(key, attempt);
  return attempt;
}

async function performSignIn(
  walletAddress: string,
  chainId: number,
  signMessageAsync: (args: { message: string }) => Promise<string>
): Promise<void> {
  const { nonce, domain, uri, expiresInSeconds } = await requestNonce(walletAddress);

  const message = new SiweMessage({
    domain,
    address: walletAddress,
    statement: "Sign in to Oplier.",
    uri,
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  }).prepareMessage();

  const signature = await signMessageAsync({ message });
  const { walletAddress: verifiedAddress, accessToken } = await verifySiwe(message, signature);

  useAuthStore.getState().setSession(verifiedAddress, accessToken);
}
