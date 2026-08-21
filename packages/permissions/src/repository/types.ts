import type { NexusPermissionRowStatus } from "../types";

/**
 * Persistence port over `nexus_permissions` (full_schema.txt / SCHEMA.md). Append-style, not
 * 1:1 with a System — every modification revokes the old row and inserts a new one (doc 02
 * "Modification"), so "the current permission for a System" means "the most recent
 * non-REVOKED row for that systemId," same rule SCHEMA.md states.
 *
 * This mirrors Part C's own repository seam (ENGINE_CONTRACT.md §2) for the same reason: no
 * live Postgres/Supabase connection exists in this build environment either (see FINDINGS.md
 * preamble), so this is the only way to make `permission-lifecycle.ts` actually runnable and
 * testable today rather than shipping untested code. If the manager thread would rather this
 * package import `@oplier/db` directly, that's a one-file change (delete this interface, point
 * call sites at Drizzle calls copied out of `drizzle-adapter.ts`) — same offer Part C made.
 */
export interface NexusPermissionRepository {
  insert(row: NexusPermissionInsert): Promise<NexusPermissionRow>;
  markRevoked(id: string, revokedAt: Date): Promise<void>;
  /** Most recent non-REVOKED row for a System, or null if none exists yet / all revoked. */
  findCurrentForSystem(systemId: string): Promise<NexusPermissionRow | null>;
  /** Full history for a System, newest first — used by delete-logs / audit views, not the hot
   *  path (mirrors why `executions`/`positions` keep full history per SCHEMA.md 8a). */
  findHistoryForSystem(systemId: string): Promise<NexusPermissionRow[]>;
}

export interface NexusPermissionInsert {
  systemId: string | null;
  scope: unknown; // JSONB — contract/function/params/spending limits/time/chain, per doc 02
  sessionReference: string | null;
}

export interface NexusPermissionRow extends NexusPermissionInsert {
  id: string;
  status: NexusPermissionRowStatus;
  createdAt: Date;
  revokedAt: Date | null;
}
