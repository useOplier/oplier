import { pgEnum } from "drizzle-orm/pg-core";

/**
 * System (UPM) lifecycle state — doc 04 §10, doc 05 §25.
 * DELETED is intentionally NOT a value here — deletion removes the row (doc 04 §20, doc 05 §33).
 *
 * AUTHORIZATION_REQUIRED is the pre-authorized state: the System exists and has been validated,
 * but no on-chain Smart Session permission has been granted for it yet, so it must not execute.
 * `apps/api` writes this on create/modify/reauthorize (it has no chain access), and the worker's
 * activation reconciler flips it to ACTIVE once the grant succeeds. `apps/web` was already built
 * expecting this value (SystemCard.tsx renders a "Needs authorization" badge for it) — it was
 * missing here, which is why System creation had to lie and write ACTIVE.
 * Appended last on purpose: Postgres `ALTER TYPE ... ADD VALUE` without BEFORE/AFTER appends, so
 * the migration stays a single unordered add.
 */
export const systemStatusEnum = pgEnum("system_status", [
  "ACTIVE",
  "PAUSED",
  "HALTED",
  "EXPIRED",
  "COMPLETE",
  "AUTHORIZATION_REQUIRED",
]);

/**
 * Per-run status. A run is a single activation/reactivation lifecycle of a System
 * (doc 05 §21-22). There is no PAUSED run state — pausing is tracked on `systems.status`
 * without ending the underlying run.
 */
export const runStatusEnum = pgEnum("run_status", [
  "ACTIVE",
  "HALTED",
  "EXPIRED",
  "COMPLETE",
]);

/** MVP condition primitives — doc 04 §2. */
export const conditionTypeEnum = pgEnum("condition_type", [
  "PRICE_VALUE",
  "PRICE_PERCENT",
  "ROI",
  "TIME",
  "HIGH_IMPACT_NEWS",
]);

/** Flat AND/OR grouping of conditions within a single step — doc 05 §34. No nesting in MVP. */
export const groupOperatorEnum = pgEnum("group_operator", ["AND", "OR"]);

/** Exactly three MVP swap amount primitives — doc 04 §6. */
export const amountTypeEnum = pgEnum("amount_type", [
  "FIXED",
  "CURRENT_BALANCE_PERCENT",
  "SYSTEM_START_BALANCE_PERCENT",
]);

/** Step execution lock state — doc 05 §19. */
export const executionStateEnum = pgEnum("execution_state", [
  "WAITING",
  "EXECUTING",
  "COMPLETED",
]);

/** On-chain transaction status — doc 05 §15-16. */
export const txStatusEnum = pgEnum("tx_status", ["PENDING", "SUCCESS", "FAILED"]);

/** Whether a transaction came from an autonomous System step or a one-off Chat-approved transaction — doc 02. */
export const transactionSourceEnum = pgEnum("transaction_source", ["SYSTEM", "ONE_OFF"]);

/** Position lifecycle — doc 06 §8. See SCHEMA.md "Design decisions" for open/close semantics. */
export const positionStatusEnum = pgEnum("position_status", ["OPEN", "CLOSED"]);

/** Nexus Smart Session permission lifecycle — doc 02 "Smart wallet infrastructure". */
export const nexusPermissionStatusEnum = pgEnum("nexus_permission_status", [
  "CREATED",
  "REVOKED",
]);

/** Asset classification — doc 01 §8, doc 05 §1-2. */
export const assetTypeEnum = pgEnum("asset_type", ["RWA", "STABLECOIN"]);

/** Environment-based asset swap — doc 01 §12: TESTNET uses mock assets, MAINNET uses real assets. */
export const environmentEnum = pgEnum("environment", ["TESTNET", "MAINNET"]);

/** Chat message author — doc 03 LLM #1 chat context. */
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant", "tool"]);
