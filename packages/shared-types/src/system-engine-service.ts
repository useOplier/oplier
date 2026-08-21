import type { SystemSpec, SystemStatus } from "./system-spec.js";

/**
 * The interface Part B's REST routes call and Part C's execution engine fully implements.
 * Part B brief §"Interface contract": "Part B implements as a thin pass-through/stub now, and
 * Part C implements fully. This lets Part B's routes be written against an interface today
 * without waiting for Part C's chat to finish."
 *
 * KNOWN GAP IN PART B'S STUB (see API_CONTRACT.md "Known stub limitations"): `createSystem`'s
 * stub implementation persists the System definition (systems/system_runs/system_steps/
 * conditions/swaps rows) and sets status ACTIVE, but does NOT create a real Nexus Smart
 * Session permission — that's Part E's job. Until Part E exists, Systems created through this
 * stub have no actual on-chain authorization backing them. Do not treat a Part-B-created
 * System as production-ready.
 */
export interface SystemEngineService {
  /**
   * Validates (via the capability registry hard gate — see registries/validate-system-spec.ts)
   * and persists a new System definition + its first run. Returns the created system's id.
   * Throws a typed error (see api-errors.ts) if validation fails; no partial System is ever
   * created (doc 04 §18-19).
   */
  createSystem(walletAddress: string, spec: SystemSpec): Promise<{ systemId: string }>;

  /**
   * Every modification revokes the old Nexus permission and creates a new one (doc 02
   * "Modification"). The System continues from its current execution state — this does not
   * restart it (doc 04 §15).
   */
  modifySystem(
    walletAddress: string,
    systemId: string,
    spec: Partial<SystemSpec>,
  ): Promise<{ systemId: string }>;

  /** ACTIVE -> PAUSED. Does not revoke permissions or reset state (doc 04 §11). */
  pauseSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }>;

  /** PAUSED -> ACTIVE, from the existing state and remaining limits (doc 04 §11). */
  resumeSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }>;

  /**
   * Reactivates a COMPLETE/EXPIRED System: same System, same history, starts from Step 1 of a
   * NEW run, does not carry over previous consumed allowance, creates new Nexus permissions
   * (doc 04 §14). NOT in Part B brief's literal endpoint list — added because doc 04 §14 is a
   * locked product behavior with no other place to live; flagged for confirmation.
   */
  reactivateSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }>;

  /**
   * Recovers from an authorization-required state (doc 02 "Invalid/failed authorization") by
   * creating a fresh Nexus permission/session per the System's current configuration. Distinct
   * from resume — this is for a failed/invalid authorization, not a user-initiated pause.
   * Same "not in the literal brief list" flag as reactivateSystem.
   */
  reauthorizeSystem(walletAddress: string, systemId: string): Promise<{ status: SystemStatus }>;

  /**
   * Permanently removes the System: revokes its Nexus permission, then removes the row
   * (doc 04 §20). DELETED is not a systems.status value — the row is gone.
   */
  deleteSystem(walletAddress: string, systemId: string): Promise<{ deleted: true }>;
}
