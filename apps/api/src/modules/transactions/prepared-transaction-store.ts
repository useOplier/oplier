import { randomUUID } from "node:crypto";

/**
 * DELIBERATE MVP SIMPLIFICATION — same pattern and same tradeoffs as auth/nonce-store.ts, for
 * the same reason: SCHEMA.md has no table for an ephemeral, short-lived "prepared but not yet
 * signed" transaction, and per the standing instruction not to alter Part A's schema without
 * flagging it back, this stays in-process memory rather than a new DB table.
 *
 * A prepared transaction is a short-lived quote-like object (doc 02 "One-off transactions"
 * steps 2-5: prepared, shown in Chat, Approve/Cancel). It has no durable value once it expires
 * or is acted on — nothing here needs to survive a backend restart, matching doc 08 §3's
 * single-EC2-process MVP deployment. Does NOT survive horizontal scaling without a shared
 * store (e.g. Redis) — same caveat as the nonce store, revisit together if either changes.
 *
 * `getPreparedTransaction` isn't called by anything yet — it's here for the not-yet-built
 * "confirm/execute after wallet signing" endpoint (doc 02 steps 6-9) to look up what was
 * actually approved. Exposed now so that endpoint doesn't need to duplicate this store.
 */

export interface PreparedTransactionEntry {
  walletAddress: string;
  sourceAsset: string;
  destinationAsset: string;
  amount: string;
  amountAsset: string;
  estimatedOutput: string;
  expiresAt: number;
}

const TTL_MS = 2 * 60 * 1000; // 2 minutes — a deliberate judgment call: long enough to review
// an Approve/Cancel card in Chat, short enough that a stale price estimate doesn't linger.

const store = new Map<string, PreparedTransactionEntry>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}

export function createPreparedTransaction(
  entry: Omit<PreparedTransactionEntry, "expiresAt">,
): { transactionId: string; expiresInSeconds: number } {
  purgeExpired();
  const transactionId = randomUUID();
  store.set(transactionId, { ...entry, expiresAt: Date.now() + TTL_MS });
  return { transactionId, expiresInSeconds: TTL_MS / 1000 };
}

export function getPreparedTransaction(transactionId: string): PreparedTransactionEntry | undefined {
  purgeExpired();
  return store.get(transactionId);
}

/**
 * Atomically claims a prepared transaction for execution: returns it and removes it from the
 * store, so a second approve of the same id finds nothing (double-spend guard). Used by
 * POST /transactions/:id/approve.
 */
export function consumePreparedTransaction(transactionId: string): PreparedTransactionEntry | undefined {
  purgeExpired();
  const entry = store.get(transactionId);
  if (entry) store.delete(transactionId);
  return entry;
}
