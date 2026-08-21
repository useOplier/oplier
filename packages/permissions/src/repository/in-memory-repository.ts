import { randomUUID } from "node:crypto";
import type {
  NexusPermissionInsert,
  NexusPermissionRepository,
  NexusPermissionRow,
} from "./types";

/** Fully runnable, used by the test suite — same role as Part C's in-memory-repository.ts. */
export class InMemoryNexusPermissionRepository implements NexusPermissionRepository {
  private rows: NexusPermissionRow[] = [];

  async insert(row: NexusPermissionInsert): Promise<NexusPermissionRow> {
    const inserted: NexusPermissionRow = {
      ...row,
      id: randomUUID(),
      status: "CREATED",
      createdAt: new Date(),
      revokedAt: null,
    };
    this.rows.push(inserted);
    return inserted;
  }

  async markRevoked(id: string, revokedAt: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return; // see revokePermission's idempotency note in alchemy-permission-service.ts
    row.status = "REVOKED";
    row.revokedAt = revokedAt;
  }

  async findCurrentForSystem(systemId: string): Promise<NexusPermissionRow | null> {
    const forSystem = this.rows
      .filter((r) => r.systemId === systemId && r.status === "CREATED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return forSystem[0] ?? null;
  }

  async findHistoryForSystem(systemId: string): Promise<NexusPermissionRow[]> {
    return this.rows
      .filter((r) => r.systemId === systemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Test helper only — not part of the interface. */
  _allRows(): NexusPermissionRow[] {
    return [...this.rows];
  }
}
