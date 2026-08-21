import { generateNonce } from "siwe";

/**
 * DELIBERATE MVP SIMPLIFICATION — flagged explicitly rather than silently added to Part A's
 * schema. SCHEMA.md has no `nonces` table, and per the instruction not to alter Part A's
 * schema without flagging it back: this stores nonces in-process memory instead.
 *
 * Why this is acceptable for the MVP: doc 08 §3 has the backend running as a single EC2
 * process (not horizontally scaled), and a nonce only needs to survive the few seconds
 * between GET /auth/nonce and POST /auth/verify. Trade-offs, made explicit:
 *  - Does NOT survive a backend restart — a nonce issued right before a deploy/crash is lost
 *    and that specific sign-in attempt must be retried (not degrading, just occasionally
 *    inconvenient).
 *  - Does NOT work if the backend is ever horizontally scaled without a shared store (e.g.
 *    Redis) — worth revisiting before that happens.
 * If either of those becomes a real constraint, swap this for a Redis-backed store or (if a
 * schema change is acceptable) a `nonces` table Part A would need to add.
 */

interface NonceEntry {
  expiresAt: number;
}

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes — generous enough for a wallet signing prompt

const store = new Map<string, NonceEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [nonce, entry] of store) {
    if (entry.expiresAt <= now) store.delete(nonce);
  }
}

export function issueNonce(): { nonce: string; expiresInSeconds: number } {
  purgeExpired();
  const nonce = generateNonce();
  store.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS });
  return { nonce, expiresInSeconds: NONCE_TTL_MS / 1000 };
}

/**
 * Single-use: a nonce is removed the moment it's consumed, whether or not the SIWE signature
 * itself later checks out. This is what actually prevents replay — `SiweMessage.verify()` only
 * checks the nonce field *matches* what's passed in, it has no concept of single-use on its own.
 */
export function consumeNonce(nonce: string): boolean {
  purgeExpired();
  return store.delete(nonce);
}
