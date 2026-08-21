import {
  type AnyPgColumn,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { assetRegistry } from "./assets";
import { groupOperatorEnum, runStatusEnum, systemStatusEnum } from "./enums";
import { users } from "./users";

/**
 * A System (UPM — Unmanned Position Manager, doc 07 §3) is the persistent definition:
 * ordered steps, each with one condition group + one swap (doc 04 §1, §4). This table is
 * the definition only — it must never be conflated with `system_runs`, which tracks a
 * single activation/reactivation's live execution state (doc 04 §14, doc 05 §21 — explicit
 * constraint from the brief: "never conflate systems and system_runs into one table").
 *
 * `maxAllocation` is mandatory and always explicit user input (doc 02 "Systems" — the AI
 * must never guess, infer, or use Memory as the max allocation). `maxAllocationAsset` pins
 * the denomination asset so the number is unambiguous.
 *
 * `currentRunId` points at whichever `system_runs` row is currently live for this System.
 * It's a plain nullable FK with `onDelete: "set null"` rather than being treated as part of
 * the System's definition — it's a pointer to current run state, not run state itself.
 */
export const systems = pgTable("systems", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address")
    .notNull()
    .references(() => users.walletAddress, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: systemStatusEnum("status").notNull().default("ACTIVE"),
  maxAllocation: numeric("max_allocation", { precision: 38, scale: 18 }).notNull(),
  maxAllocationAsset: text("max_allocation_asset")
    .notNull()
    .references(() => assetRegistry.assetId),
  /** Optional System-level expiration, separate from a step's TIME condition (doc 04 §13). */
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Required execution-limit configuration (doc 04 §4 system-level fields). */
  executionLimit: integer("execution_limit").notNull(),
  currentRunId: uuid("current_run_id").references((): AnyPgColumn => systemRuns.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A single activation/reactivation lifecycle of a System (doc 05 §21: "System definition and
 * its execution runs are separate... each activation/reactivation receives a new run_id").
 * Reactivating a COMPLETE/EXPIRED System creates a fresh row here rather than mutating the
 * previous one, preserving history (doc 05 §22, §29).
 *
 * `currentStepId` is where "current step eligibility" (asked for on `system_steps` in the
 * brief) actually lives — see SCHEMA.md "Design decisions" for why it was moved here instead
 * of onto the step-definition table.
 */
export const systemRuns = pgTable(
  "system_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * SET NULL, not CASCADE: run history must survive System deletion (doc 05 §32 — "Delete
     * Logs" is a separate, optional action from deleting the System, which only makes sense
     * if deleting the System doesn't already wipe history). Nullable so the FK action has
     * somewhere to go.
     */
    systemId: uuid("system_id").references(() => systems.id, { onDelete: "set null" }),
    runNumber: integer("run_number").notNull(),
    status: runStatusEnum("status").notNull().default("ACTIVE"),
    currentStepId: uuid("current_step_id").references((): AnyPgColumn => systemSteps.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    systemRunNumberUnique: unique("system_runs_system_run_number_unique").on(
      table.systemId,
      table.runNumber,
    ),
  }),
);

/**
 * Ordered step definitions (doc 04 §4-5). Structural only — no run-dependent state lives
 * here (see SCHEMA.md). Each step has exactly one condition group (flat AND/OR, doc 05 §34)
 * and exactly one swap (enforced by a unique FK on `swaps.stepId`).
 */
export const systemSteps = pgTable(
  "system_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    groupOperator: groupOperatorEnum("group_operator").notNull().default("AND"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    systemStepOrderUnique: unique("system_steps_system_step_order_unique").on(
      table.systemId,
      table.stepOrder,
    ),
  }),
);
