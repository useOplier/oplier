import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@oplier/db";
import { nexusPermissions } from "@oplier/db";
import type {
  NexusPermissionInsert,
  NexusPermissionRepository,
  NexusPermissionRow,
} from "@oplier/permissions";
import type { SessionMetadata, SessionMetadataStore } from "@oplier/permissions";
import type { PermissionContextResolver } from "../permissions/session-key-sender.js";
import { OWNER_PERMISSION_REF } from "../permissions/on-chain-revoker.js";

/**
 * Real Drizzle-backed `NexusPermissionRepository`, plus the two lookups the execution path needs on
 * top of it. `@oplier/permissions` ships its own version commented out and excluded from typecheck.
 *
 * ⚠ NOT YET RUN AGAINST A LIVE DATABASE.
 */

type PermissionRow = typeof nexusPermissions.$inferSelect;

function mapRow(row: PermissionRow): NexusPermissionRow {
  return {
    id: row.id,
    systemId: row.systemId,
    scope: row.scope,
    sessionReference: row.sessionReference,
    status: row.status,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export class DrizzleNexusPermissionRepository implements NexusPermissionRepository {
  constructor(private readonly db: Database) {}

  async insert(row: NexusPermissionInsert): Promise<NexusPermissionRow> {
    const [inserted] = await this.db
      .insert(nexusPermissions)
      .values({
        systemId: row.systemId,
        scope: row.scope as Record<string, unknown>,
        sessionReference: row.sessionReference,
        status: "CREATED",
      })
      .returning();
    if (!inserted) throw new Error("failed to insert nexus_permissions row");
    return mapRow(inserted);
  }

  async markRevoked(id: string, revokedAt: Date): Promise<void> {
    await this.db
      .update(nexusPermissions)
      .set({ status: "REVOKED", revokedAt })
      .where(eq(nexusPermissions.id, id));
  }

  async findCurrentForSystem(systemId: string): Promise<NexusPermissionRow | null> {
    const [row] = await this.db
      .select()
      .from(nexusPermissions)
      .where(and(eq(nexusPermissions.systemId, systemId), eq(nexusPermissions.status, "CREATED")))
      .orderBy(desc(nexusPermissions.createdAt))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  async findHistoryForSystem(systemId: string): Promise<NexusPermissionRow[]> {
    const rows = await this.db
      .select()
      .from(nexusPermissions)
      .where(eq(nexusPermissions.systemId, systemId))
      .orderBy(desc(nexusPermissions.createdAt));
    return rows.map(mapRow);
  }
}

/**
 * The `sessionData` blob `AlchemyPermissionService.createPermission` stored inside
 * `nexus_permissions.scope`. Typed here rather than in the permissions package because the shape is
 * this worker's own storage contract with itself.
 */
interface StoredSessionData {
  context?: string;
  accountAddress?: string;
  sessionKeyAddress?: string;
  expirySec?: number;
  paymasterPolicyId?: string;
}

function readSessionData(scope: unknown): StoredSessionData | null {
  if (!scope || typeof scope !== "object") return null;
  const sessionData = (scope as { sessionData?: unknown }).sessionData;
  if (!sessionData || typeof sessionData !== "object") return null;
  return sessionData as StoredSessionData;
}

/**
 * DB-backed `SessionMetadataStore` — what makes revocation and validity checks survive a restart.
 *
 * `AlchemyPermissionService`'s default store is process-local (its predecessor's `sessionsByRef` map
 * was flagged in that file as "a real deployment persists this via the repository layer"). Since a
 * UPM can sit waiting for weeks, the operations most likely to happen after a restart are exactly
 * revoke and check — the two that need this metadata. It is read back out of
 * `nexus_permissions.scope`, where `createPermission` already writes it, so no new table is needed.
 */
export class DrizzleSessionMetadataStore implements SessionMetadataStore {
  constructor(
    private readonly db: Database,
    private readonly deriveEntityId: (systemId: string) => number,
  ) {}

  async get(permissionRef: string): Promise<SessionMetadata | null> {
    // `session_reference` holds this package's opaque permissionRef.
    const [row] = await this.db
      .select()
      .from(nexusPermissions)
      .where(eq(nexusPermissions.sessionReference, permissionRef))
      .orderBy(desc(nexusPermissions.createdAt))
      .limit(1);
    if (!row) return null;

    const sessionData = readSessionData(row.scope);
    if (!sessionData?.context || !sessionData.accountAddress || !sessionData.sessionKeyAddress) return null;
    if (!row.systemId) return null; // System deleted; nothing left to revoke against

    return {
      systemId: row.systemId,
      accountAddress: sessionData.accountAddress as `0x${string}`,
      sessionKeyAddress: sessionData.sessionKeyAddress as `0x${string}`,
      context: sessionData.context as `0x${string}`,
      expirySec: sessionData.expirySec ?? 0,
      entityId: this.deriveEntityId(row.systemId),
    };
  }

  /**
   * No-op: the row is written by `engine-adapter.ts` -> `NexusPermissionRepository.insert` as part
   * of the same `createPermission` flow, with `sessionData` already inside `scope`. Writing again
   * here would create a second row for one permission and break "most recent non-REVOKED row is the
   * active permission".
   */
  async put(): Promise<void> {
    /* intentionally empty — see doc comment */
  }

  /**
   * No-op: revocation is recorded by flipping `status` to REVOKED (`markRevoked`), preserving the
   * row. doc 05 §32 requires permission history to survive, so nothing is ever deleted here.
   */
  async delete(): Promise<void> {
    /* intentionally empty — see doc comment */
  }
}

/**
 * Resolves what the session-key sender needs to submit under a permissionRef.
 *
 * Also handles `OWNER_PERMISSION_REF`, the sentinel meaning "submit under the smart account owner's
 * own authority" — used for account administration like `uninstallValidation`, which a scoped
 * session key must not be able to perform.
 */
export class DrizzlePermissionContextResolver implements PermissionContextResolver {
  constructor(
    private readonly store: DrizzleSessionMetadataStore,
    private readonly ownerContext: () => { accountAddress: `0x${string}`; paymasterPolicyId: string } | null,
  ) {}

  async resolve(permissionRef: string): Promise<{
    context: `0x${string}`;
    accountAddress: `0x${string}`;
    systemId: string;
    paymasterPolicyId: string;
  } | null> {
    if (permissionRef === OWNER_PERMISSION_REF) {
      const owner = this.ownerContext();
      if (!owner) return null;
      return {
        // Empty context = no session-key permissions capability; the call is authorized by the
        // owner signer instead. `prepareCalls` treats an empty context as "no delegated permission".
        context: "0x",
        accountAddress: owner.accountAddress,
        systemId: OWNER_PERMISSION_REF,
        paymasterPolicyId: owner.paymasterPolicyId,
      };
    }

    const meta = await this.store.get(permissionRef);
    if (!meta) return null;

    const owner = this.ownerContext();
    return {
      context: meta.context,
      accountAddress: meta.accountAddress,
      systemId: meta.systemId,
      // Policy id is process config, not per-permission state, so fall back to the live value rather
      // than trusting a stale copy persisted at creation time (the dashboard policy can be rotated).
      paymasterPolicyId: owner?.paymasterPolicyId ?? "",
    };
  }
}

/** Orphaned CREATED permissions whose System is gone — surfaced by the runbook's audit command. */
export async function listOrphanedPermissions(db: Database): Promise<NexusPermissionRow[]> {
  const rows = await db
    .select()
    .from(nexusPermissions)
    .where(and(isNull(nexusPermissions.systemId), eq(nexusPermissions.status, "CREATED")));
  return rows.map(mapRow);
}
