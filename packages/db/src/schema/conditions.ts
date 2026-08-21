import { boolean, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { conditionTypeEnum } from "./enums";
import { systemSteps } from "./systems";

/**
 * One condition within a step's flat AND/OR group (doc 04 §2, doc 05 §34). `parameters`
 * shape depends on `conditionType` — documented per-type with examples in SCHEMA.md rather
 * than modeled as five separate tables, since the primitives are simple and versioned
 * centrally in `capability_registry` anyway.
 *
 * `currentState` is the live TRUE/FALSE evaluation state (doc 05 §35: "For a waiting step,
 * condition state is minimal: TRUE/FALSE... condition history is not stored as execution
 * state"). This reflects state for the System's *current* run only (via `systems.currentRunId`)
 * and is reset to `false` on reactivation (doc 05 §22 "no previous condition-trigger state") —
 * see SCHEMA.md "Design decisions".
 */
export const conditions = pgTable("conditions", {
  id: uuid("id").primaryKey().defaultRandom(),
  stepId: uuid("step_id")
    .notNull()
    .references(() => systemSteps.id, { onDelete: "cascade" }),
  conditionType: conditionTypeEnum("condition_type").notNull(),
  parameters: jsonb("parameters").notNull(),
  currentState: boolean("current_state").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
