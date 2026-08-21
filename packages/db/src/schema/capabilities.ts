import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Machine-readable, versioned capability definition (doc 02 "Systems"). This is the
 * authoritative source LLM #1 and the backend validator both check requested System
 * conditions/swaps against — never the LLM's own judgment (doc 03 LLM #1 "Backend authority").
 *
 * `conditionTypes` / `swapAmountTypes` hold the param schema for each supported primitive
 * (doc 04 §2, §6) so new primitives can be added by inserting a new version row rather than
 * a code migration touching every part.
 *
 * Only one version should be active at a time. `oneActiveIdx` is a partial unique index
 * enforcing that at the database level rather than relying on application discipline alone.
 */
export const capabilityRegistry = pgTable(
  "capability_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    conditionTypes: jsonb("condition_types").notNull(),
    swapAmountTypes: jsonb("swap_amount_types").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    versionUnique: unique("capability_registry_version_unique").on(table.version),
    oneActiveIdx: uniqueIndex("capability_registry_one_active_idx")
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  }),
);
