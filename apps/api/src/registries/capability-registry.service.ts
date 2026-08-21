import { eq } from "drizzle-orm";
import { capabilityRegistry, type Database } from "@oplier/db";
import { ApiError, type CapabilityRegistryEntry } from "@oplier/shared-types";

/**
 * Read-only service over `capability_registry` (Part B brief §3). Exposes the currently
 * active version's supported condition/amount types. This is deliberately thin — the actual
 * validation logic lives in `validate-system-spec.ts`, which is the single function Part C's
 * engine and Part G's LLM tools must both call (brief: "Do not let two different validation
 * implementations exist").
 */
export class CapabilityRegistryService {
  constructor(private readonly db: Database) {}

  private toEntry(row: typeof capabilityRegistry.$inferSelect): CapabilityRegistryEntry {
    return {
      id: row.id,
      version: row.version,
      isActive: row.isActive,
      conditionTypes: row.conditionTypes as Record<string, unknown>,
      swapAmountTypes: row.swapAmountTypes as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * There should be at most one active row at any time — enforced at the DB level by
   * `capability_registry_one_active_idx` (a partial unique index on `is_active = true`), not
   * just this query picking the first match.
   */
  async getActive(): Promise<CapabilityRegistryEntry> {
    const rows = await this.db
      .select()
      .from(capabilityRegistry)
      .where(eq(capabilityRegistry.isActive, true))
      .limit(1);
    const row = rows[0];
    if (!row) {
      // Should be unreachable once seeded (packages/db/src/seed.ts seeds v1 active) — but the
      // backend must never silently proceed without a capability definition to validate against.
      throw new ApiError(
        "INTERNAL_ERROR",
        "No active capability_registry version found. The database has not been seeded.",
      );
    }
    return this.toEntry(row);
  }
}
