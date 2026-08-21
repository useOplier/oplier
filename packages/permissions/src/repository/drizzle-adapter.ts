/**
 * Reference sketch of the real Part A/B `nexus_permissions` mapping (full_schema.txt lines
 * ~438-452, SCHEMA.md "nexus_permissions" section). Commented out and excluded from typecheck
 * (see tsconfig.json `exclude`) — imports `@oplier/db`, which isn't installable in this
 * sandbox (no network access, see FINDINGS.md preamble). Not exercised against a live
 * database. Same caveat Part C raised for its own `drizzle-adapter.ts`: Part I's first job
 * with this file is to actually run it against Supabase before trusting it — get the current
 * `packages/db` from Part B's chat first (SCHEMA.md's "canonical maintainer" note).
 *
 * Uncomment and wire up once `@oplier/db` is installed:
 *
 * import { eq, and, desc } from "drizzle-orm";
 * import { nexusPermissions } from "@oplier/db/schema";
 * import type { Database } from "@oplier/db";
 * import type {
 *   NexusPermissionInsert,
 *   NexusPermissionRepository,
 *   NexusPermissionRow,
 * } from "./types";
 *
 * export class DrizzleNexusPermissionRepository implements NexusPermissionRepository {
 *   constructor(private readonly db: Database) {}
 *
 *   async insert(row: NexusPermissionInsert): Promise<NexusPermissionRow> {
 *     const [inserted] = await this.db
 *       .insert(nexusPermissions)
 *       .values({
 *         systemId: row.systemId,
 *         scope: row.scope,
 *         sessionReference: row.sessionReference,
 *         status: "CREATED",
 *       })
 *       .returning();
 *     return inserted as NexusPermissionRow;
 *   }
 *
 *   async markRevoked(id: string, revokedAt: Date): Promise<void> {
 *     await this.db
 *       .update(nexusPermissions)
 *       .set({ status: "REVOKED", revokedAt })
 *       .where(eq(nexusPermissions.id, id));
 *   }
 *
 *   async findCurrentForSystem(systemId: string): Promise<NexusPermissionRow | null> {
 *     const [row] = await this.db
 *       .select()
 *       .from(nexusPermissions)
 *       .where(and(eq(nexusPermissions.systemId, systemId), eq(nexusPermissions.status, "CREATED")))
 *       .orderBy(desc(nexusPermissions.createdAt))
 *       .limit(1);
 *     return (row as NexusPermissionRow) ?? null;
 *   }
 *
 *   async findHistoryForSystem(systemId: string): Promise<NexusPermissionRow[]> {
 *     return (await this.db
 *       .select()
 *       .from(nexusPermissions)
 *       .where(eq(nexusPermissions.systemId, systemId))
 *       .orderBy(desc(nexusPermissions.createdAt))) as NexusPermissionRow[];
 *   }
 * }
 *
 * Note on the `systemId` FK (SCHEMA.md 8a): it's `ON DELETE SET NULL`, not `CASCADE` — history
 * survives System deletion. `findCurrentForSystem`/`findHistoryForSystem` above are only ever
 * called with a real, non-null systemId (the System still exists at call time in every
 * lifecycle path this package implements), so the nullable FK doesn't need special-casing
 * here — it matters for *reading old history after deletion*, which is an audit/reporting
 * concern outside this part's scope, not a case `permission-lifecycle.ts` hits.
 */
export {};
