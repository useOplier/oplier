import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { executionStateEnum, txStatusEnum } from "./enums";
import { systemRuns, systems, systemSteps } from "./systems";

/**
 * One execution attempt for a given (system, run, step) triple. Unique identity is
 * `system_id + run_id + step_id` (doc 05 §20 "Duplicate Execution Protection") — enforced
 * as a DB-level unique constraint so creating the execution row IS the atomic lock doc 05
 * §20 requires ("Creation of the execution record and lock must be atomic... A completed
 * execution cannot create another transaction during the same run").
 *
 * `state` is the step-lock state (doc 05 §19: WAITING → EXECUTING → COMPLETED), kept
 * separate from `status`, the on-chain transaction outcome (doc 05 §18: "Condition state is
 * separate from transaction execution state").
 *
 * `retryable` is null until the backend classifies a failure (doc 04 §9, doc 05 §24):
 * true = transient/retry same transaction without advancing; false = non-retryable, halt the
 * System immediately. The LLM never makes this classification — backend execution layer only.
 */
export const executions = pgTable(
  "executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * SET NULL, not CASCADE: execution/transaction history must survive System deletion
     * (doc 05 §32). Nullable so the FK action has somewhere to go.
     */
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "set null" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => systemRuns.id, { onDelete: "cascade" }),
    /**
     * SET NULL, not CASCADE. `system_steps` still cascades on System deletion (it's pure
     * definition data) — if this stayed CASCADE too, deleting a System would cascade
     * systems -> system_steps -> executions and silently wipe history through this path,
     * defeating the systemId fix above. Not one of the 4 tables originally flagged, but
     * required for the fix to actually hold — see chat note.
     */
    stepId: uuid("step_id").references(() => systemSteps.id, { onDelete: "set null" }),
    state: executionStateEnum("state").notNull().default("WAITING"),
    txHash: text("tx_hash"),
    status: txStatusEnum("status"),
    retryable: boolean("retryable"),
    errorLog: text("error_log"),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    executionIdentityUnique: unique("executions_system_run_step_unique").on(
      table.systemId,
      table.runId,
      table.stepId,
    ),
  }),
);
