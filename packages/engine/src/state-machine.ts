/**
 * State machine (brief responsibility #1).
 *
 * `SystemStatus`: ACTIVE, PAUSED, HALTED, EXPIRED, COMPLETE, AUTHORIZATION_REQUIRED — exactly the
 * values in `packages/db`'s `systemStatusEnum` (full_schema.txt `enums.ts`). Deletion is not a state
 * (handled by `deleteSystem`, a hard delete + cascade/SET NULL per full_schema.txt §8a).
 *
 * AUTHORIZATION_REQUIRED means "persisted and validated, but holds no on-chain session key". Note
 * this engine never *sets* it — `apps/api` writes it, because only it knows the user asked for a
 * change, and `apps/worker`'s activation reconciler clears it once the grant lands. The transitions
 * below exist so those writes are legal and so a System sitting in that state can still expire.
 *
 * `RunStatus`: ACTIVE, HALTED, EXPIRED, COMPLETE — no PAUSED run state; pausing lives only
 * on `systems.status` (schema comment on `runStatusEnum`), which is why `pauseSystem`/
 * `resumeSystem` below only ever touch the System row, never the run row.
 */

import { EngineError } from "./types.js";
import type { RunStatus, SystemStatus } from "./types.js";

const SYSTEM_TRANSITIONS: Record<SystemStatus, SystemStatus[]> = {
  // AUTHORIZATION_REQUIRED added to most sources below: any change that invalidates the current
  // session key parks the System there until the worker re-grants (permission-relevant modify from
  // ACTIVE, resume-with-no-surviving-permission from PAUSED, reactivation from EXPIRED/COMPLETE, and
  // an explicit /reauthorize from any non-terminal state).
  ACTIVE: ["PAUSED", "HALTED", "EXPIRED", "COMPLETE", "AUTHORIZATION_REQUIRED"],
  PAUSED: ["ACTIVE", "AUTHORIZATION_REQUIRED"], // resume; doc 05 §26 pause/resume doesn't revoke or reset state
  HALTED: ["ACTIVE", "AUTHORIZATION_REQUIRED"], // resume-from-halt, per doc 04 §12
  EXPIRED: ["ACTIVE", "AUTHORIZATION_REQUIRED"], // reactivation only (new run) — see reactivation.ts
  COMPLETE: ["ACTIVE", "AUTHORIZATION_REQUIRED"], // reactivation only (new run)
  /**
   * ACTIVE is the success path — the worker granted a key. EXPIRED is legal because a System's
   * `expiresAt` can pass while it is still waiting to be authorized (a failing grant can sit here
   * across the deadline), and `checkExpiration` must be able to retire it rather than throw.
   *
   * Deliberately NOT here: PAUSED (pausing something that was never authorized is meaningless, and
   * the API returns 409 for it), HALTED (halting is an execution-failure state and an unauthorized
   * System never executes — a persistently failing grant stays put, logs loudly, and remains
   * retryable via /reauthorize), and itself (see the from === to note below).
   */
  AUTHORIZATION_REQUIRED: ["ACTIVE", "EXPIRED"],
};

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  ACTIVE: ["HALTED", "EXPIRED", "COMPLETE"],
  HALTED: ["ACTIVE"], // resume
  EXPIRED: [], // terminal for this run; reactivation creates a *new* run row
  COMPLETE: [], // terminal for this run; reactivation creates a *new* run row
};

/**
 * Deliberately does NOT special-case `from === to` as an always-legal no-op: API_CONTRACT.md
 * §3 locks `POST /systems/:id/pause` as "ACTIVE → PAUSED only; 409 otherwise" and
 * `/resume` as "PAUSED → ACTIVE only; 409 otherwise" — pausing an already-PAUSED System (or
 * resuming an already-ACTIVE one) is exactly the 409 case, not a silent success.
 */
export function assertValidSystemTransition(from: SystemStatus, to: SystemStatus): void {
  const allowed = SYSTEM_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new EngineError("CONFLICT", `Illegal System transition: ${from} -> ${to}`);
  }
}

export function assertValidRunTransition(from: RunStatus, to: RunStatus): void {
  const allowed = RUN_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new EngineError("CONFLICT", `Illegal Run transition: ${from} -> ${to}`);
  }
}
