import { getAddress, isAddress } from "viem";
import { ApiError } from "@oplier/shared-types";

/**
 * Every address is stored lowercased at the application layer (packages/db/src/schema/users.ts
 * comment: "Store addresses lowercased... EVM addresses are case-insensitive"). This is the one
 * place that normalization happens — every route/service must go through this rather than
 * lowercasing inline, so the rule can't silently drift.
 *
 * Verified against viem 2.x: `isAddress(addr)` accepts both all-lowercase input (no checksum
 * required) and correctly-checksummed mixed-case input; it rejects malformed input (wrong
 * length, invalid hex) and incorrectly-checksummed mixed-case input. `{ strict: false }` would
 * additionally accept incorrectly-checksummed mixed-case input, which we deliberately do NOT
 * want here — a wallet that hands us a mixed-case address with a broken checksum is a signal
 * worth rejecting outright rather than silently normalizing.
 */
export function normalizeWalletAddress(input: string): string {
  if (!isAddress(input)) {
    throw new ApiError("VALIDATION_ERROR", `"${input}" is not a valid EVM address.`);
  }
  return getAddress(input).toLowerCase();
}
