import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { nexusPermissionStatusEnum } from "./enums";
import { systems } from "./systems";

/**
 * Tracks Smart Session permission state per System (doc 02 "Smart wallet infrastructure" /
 * "Nexus + Smart Sessions"). This is intentionally an append-style history, not a 1:1 row
 * per System: every modification revokes the old permission and creates a new one (doc 02
 * "System authorization lifecycle" — Modification), so a System can have many rows here over
 * its lifetime. The most recent non-revoked row is the System's active permission.
 *
 * `scope` captures what doc 02 says permissions are scoped by: contract, function,
 * parameters, token spending, usage/value limits, time, and chain.
 */
export const nexusPermissions = pgTable("nexus_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * SET NULL, not CASCADE: permission history must survive System deletion (doc 05 §32).
   * Nullable so the FK action has somewhere to go. Actual on-chain revocation still happens
   * before deletion per doc 02/doc 05 §33 — this only affects what the DB row does.
   */
  systemId: uuid("system_id").references(() => systems.id, { onDelete: "set null" }),
  status: nexusPermissionStatusEnum("status").notNull().default("CREATED"),
  scope: jsonb("scope").notNull(),
  /** Biconomy Smart Session identifier/hash, opaque to this schema. */
  sessionReference: text("session_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
