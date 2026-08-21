import { SiweMessage } from "siwe";
import { ApiError } from "@oplier/shared-types";
import { consumeNonce } from "./nonce-store.js";
import { normalizeWalletAddress } from "../lib/address.js";
import type { Env } from "../config/env.js";

/**
 * Verifies a client-submitted SIWE message + signature (POST /auth/verify). Every field
 * (address, nonce, domain, chainId, expiration) is re-derived from `rawMessage` itself via
 * `SiweMessage`'s own ABNF parser and `.verify()` — never trusted from separately-supplied
 * request fields, so a caller can't send a valid signature for one message alongside claims
 * about a different one.
 *
 * Nonce is consumed (single-use) BEFORE calling `.verify()`: if the nonce was never issued or
 * was already used, fail immediately without spending time on signature verification. If it
 * WAS issued but the signature turns out invalid, the nonce is still burned — an attacker
 * doesn't get unlimited attempts against one nonce either way.
 */
export async function verifySiweSignIn(
  rawMessage: string,
  signature: string,
  env: Env,
): Promise<{ walletAddress: string }> {
  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(rawMessage);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Malformed SIWE message.");
  }

  if (!consumeNonce(siweMessage.nonce)) {
    throw new ApiError("UNAUTHORIZED", "Nonce is invalid, expired, or already used.");
  }

  const result = await siweMessage.verify({
    signature,
    domain: env.SIWE_DOMAIN,
  });

  if (!result.success) {
    throw new ApiError(
      "UNAUTHORIZED",
      `SIWE verification failed: ${result.error?.type ?? "unknown error"}.`,
    );
  }

  return { walletAddress: normalizeWalletAddress(result.data.address) };
}
