import { hkdfSync } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { LocalAccountSigner } from "@aa-sdk/core";
import type { PrivateKeyAccount } from "viem";
import type { SessionKeyProvider, SessionKeyRef } from "@oplier/permissions";

/**
 * Deterministic per-System session keys.
 *
 * The problem this solves: `grantPermissions` needs a session key's public key at creation time,
 * and every later call the session key authorizes needs its PRIVATE key to sign with. The worker
 * therefore has to be able to reproduce a System's session key indefinitely — including after a
 * restart, which for a long-running UPM is a certainty, not an edge case.
 *
 * Two ways to do that:
 *   (a) generate a random key per System and persist it (encrypted) in the database, or
 *   (b) DERIVE it from one master secret plus the systemId.
 *
 * (b) is chosen. It means no private key is ever written to the database at all — the worker holds
 * exactly one secret (`SESSION_KEY_MASTER_SEED`), and any number of System session keys fall out of
 * it reproducibly. That shrinks the at-rest secret surface to a single env var the runbook can
 * protect properly, and removes a whole class of "the DB backup contains spending keys" problem.
 *
 * HKDF-SHA256 with the systemId as `info` is used rather than a bare hash so that the derivation is
 * a standard KDF with domain separation, not homemade key-stretching.
 *
 * ⚠ Rotating `SESSION_KEY_MASTER_SEED` orphans every existing session key: the worker will derive
 * different keys and can no longer sign for sessions already granted on-chain. Those Systems need
 * their permissions recreated. See DEPLOYMENT_RUNBOOK.md before changing it.
 */

const HKDF_SALT = "oplier/session-key/v1";
const HKDF_KEY_BYTES = 32;

export class DerivedSessionKeyProvider implements SessionKeyProvider {
  private readonly cache = new Map<string, PrivateKeyAccount>();
  private readonly signerCache = new Map<string, LocalAccountSigner<PrivateKeyAccount>>();

  constructor(private readonly masterSeed: string) {
    if (masterSeed.length < 32) {
      throw new Error("SESSION_KEY_MASTER_SEED must be at least 32 characters");
    }
  }

  /** The full signing account for a System — needed to sign prepared calls. */
  getAccountForSystem(systemId: string): PrivateKeyAccount {
    const cached = this.cache.get(systemId);
    if (cached) return cached;

    const derived = hkdfSync("sha256", this.masterSeed, HKDF_SALT, `system:${systemId}`, HKDF_KEY_BYTES);
    const privateKey = `0x${Buffer.from(derived).toString("hex")}` as `0x${string}`;
    const account = privateKeyToAccount(privateKey);
    this.cache.set(systemId, account);
    return account;
  }

  /**
   * The same derived key wrapped as an `@aa-sdk/core` `SmartAccountSigner` — this is what
   * `signPreparedCalls` requires, and passing the bare viem account instead FAILS AT RUNTIME.
   *
   * The two `signMessage` signatures are incompatible in a way the type system did not catch here
   * (the sender casts its client/signer deps): the SDK calls `signer.signMessage(data)` where `data`
   * is the signature request's payload, e.g. `{ raw: "0x..." }`. `SmartAccountSigner.signMessage`
   * accepts exactly that shape. A viem `PrivateKeyAccount.signMessage` instead expects
   * `{ message }`, so it reads `parameters.message` as `undefined` and dies inside viem with
   * `TypeError: Cannot read properties of undefined (reading 'raw')` from `toPrefixedMessage`.
   * Observed as a `cycle_error` on every swap attempt, i.e. no UPM could ever submit.
   *
   * Cached alongside the account so key derivation still happens once per System.
   */
  getSignerForSystem(systemId: string): LocalAccountSigner<PrivateKeyAccount> {
    const cached = this.signerCache.get(systemId);
    if (cached) return cached;

    const signer = new LocalAccountSigner(this.getAccountForSystem(systemId));
    this.signerCache.set(systemId, signer);
    return signer;
  }

  async getSessionKeyForSystem(systemId: string): Promise<SessionKeyRef> {
    const account = this.getAccountForSystem(systemId);
    return {
      address: account.address,
      // For a secp256k1 session key Alchemy's `key.publicKey` is the signer ADDRESS, per the SDK's
      // own example (`publicKey: await sessionKey.getAddress()`), not a 33/65-byte pubkey.
      publicKey: account.address,
    };
  }
}
