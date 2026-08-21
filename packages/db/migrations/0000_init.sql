-- Part A: initial schema for Oplier.
--
-- NOTE ON PROVENANCE: this file was hand-authored to mirror src/schema/*.ts exactly, because
-- the sandbox this was built in has no network access and could not `pnpm install` drizzle-kit
-- to run `drizzle-kit generate` for real. Once you can install dependencies, run:
--   pnpm --filter @oplier/db run generate
-- and diff the tool's output against this file as a sanity check before trusting it against a
-- real database. Treat this file as a strong draft, not a substitute for that verification step.
--
-- PATCH (post-initial-review): system_runs/executions/positions/nexus_permissions.system_id,
-- and executions.step_id, changed from NOT NULL + ON DELETE CASCADE to nullable + ON DELETE
-- SET NULL, so execution/position/permission history survives System deletion (doc 05 §32).
-- system_steps/conditions/swaps still cascade — they're pure definition data, not history.

CREATE TYPE "system_status" AS ENUM ('ACTIVE', 'PAUSED', 'HALTED', 'EXPIRED', 'COMPLETE');
CREATE TYPE "run_status" AS ENUM ('ACTIVE', 'HALTED', 'EXPIRED', 'COMPLETE');
CREATE TYPE "condition_type" AS ENUM ('PRICE_VALUE', 'PRICE_PERCENT', 'ROI', 'TIME', 'HIGH_IMPACT_NEWS');
CREATE TYPE "group_operator" AS ENUM ('AND', 'OR');
CREATE TYPE "amount_type" AS ENUM ('FIXED', 'CURRENT_BALANCE_PERCENT', 'SYSTEM_START_BALANCE_PERCENT');
CREATE TYPE "execution_state" AS ENUM ('WAITING', 'EXECUTING', 'COMPLETED');
CREATE TYPE "tx_status" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
CREATE TYPE "transaction_source" AS ENUM ('SYSTEM', 'ONE_OFF');
CREATE TYPE "position_status" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "nexus_permission_status" AS ENUM ('CREATED', 'REVOKED');
CREATE TYPE "asset_type" AS ENUM ('RWA', 'STABLECOIN');
CREATE TYPE "environment" AS ENUM ('TESTNET', 'MAINNET');
CREATE TYPE "chat_role" AS ENUM ('user', 'assistant', 'tool');

CREATE TABLE "users" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "settings" (
	"wallet_address" text PRIMARY KEY NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"max_slippage_default_bps" integer DEFAULT 100 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "asset_registry" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"underlying_asset" text,
	"price_feed_id" text,
	"token_address" text NOT NULL,
	"network" text NOT NULL,
	"environment" "environment" NOT NULL,
	"decimals" integer NOT NULL,
	"availability" boolean DEFAULT true NOT NULL,
	"supported_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trading_pairs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_registry_symbol_environment_unique" UNIQUE("symbol","environment")
);

CREATE TABLE "asset_prices" (
	"asset_id" text PRIMARY KEY NOT NULL REFERENCES "asset_registry"("asset_id") ON DELETE CASCADE,
	"price" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'pyth' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"is_stale" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "asset_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text NOT NULL REFERENCES "asset_registry"("asset_id") ON DELETE CASCADE,
	"price" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'pyth' NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
CREATE INDEX "asset_price_history_asset_observed_at_idx" ON "asset_price_history" ("asset_id","observed_at");

CREATE TABLE "capability_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"condition_types" jsonb NOT NULL,
	"swap_amount_types" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_registry_version_unique" UNIQUE("version")
);
CREATE UNIQUE INDEX "capability_registry_one_active_idx" ON "capability_registry" ("is_active") WHERE "is_active" = true;

CREATE TABLE "systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"name" text NOT NULL,
	"status" "system_status" DEFAULT 'ACTIVE' NOT NULL,
	"max_allocation" numeric(38, 18) NOT NULL,
	"max_allocation_asset" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"expires_at" timestamp with time zone,
	"execution_limit" integer NOT NULL,
	"current_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "system_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid REFERENCES "systems"("id") ON DELETE SET NULL,
	"run_number" integer NOT NULL,
	"status" "run_status" DEFAULT 'ACTIVE' NOT NULL,
	"current_step_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "system_runs_system_run_number_unique" UNIQUE("system_id","run_number")
);

CREATE TABLE "system_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL REFERENCES "systems"("id") ON DELETE CASCADE,
	"step_order" integer NOT NULL,
	"group_operator" "group_operator" DEFAULT 'AND' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_steps_system_step_order_unique" UNIQUE("system_id","step_order")
);

-- Circular FKs added after both sides exist.
ALTER TABLE "systems" ADD CONSTRAINT "systems_current_run_id_system_runs_id_fk"
	FOREIGN KEY ("current_run_id") REFERENCES "system_runs"("id") ON DELETE SET NULL;
ALTER TABLE "system_runs" ADD CONSTRAINT "system_runs_current_step_id_system_steps_id_fk"
	FOREIGN KEY ("current_step_id") REFERENCES "system_steps"("id") ON DELETE SET NULL;

CREATE TABLE "conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL REFERENCES "system_steps"("id") ON DELETE CASCADE,
	"condition_type" "condition_type" NOT NULL,
	"parameters" jsonb NOT NULL,
	"current_state" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_id" uuid NOT NULL UNIQUE REFERENCES "system_steps"("id") ON DELETE CASCADE,
	"source_asset" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"destination_asset" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"amount_type" "amount_type" NOT NULL,
	"amount_value" numeric(38, 18) NOT NULL,
	"execution_order" integer NOT NULL,
	"max_slippage_bps" integer DEFAULT 100 NOT NULL
);

CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid REFERENCES "systems"("id") ON DELETE SET NULL,
	"run_id" uuid NOT NULL REFERENCES "system_runs"("id") ON DELETE CASCADE,
	"step_id" uuid REFERENCES "system_steps"("id") ON DELETE SET NULL,
	"state" "execution_state" DEFAULT 'WAITING' NOT NULL,
	"tx_hash" text,
	"status" "tx_status",
	"retryable" boolean,
	"error_log" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "executions_system_run_step_unique" UNIQUE("system_id","run_id","step_id")
);

CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"system_id" uuid REFERENCES "systems"("id") ON DELETE SET NULL,
	"asset_id" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"status" "position_status" DEFAULT 'OPEN' NOT NULL,
	"cost_basis" numeric(38, 18) DEFAULT '0' NOT NULL,
	"quantity" numeric(38, 18) DEFAULT '0' NOT NULL,
	"current_value" numeric(38, 18) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "positions_system_asset_unique" UNIQUE("system_id","asset_id")
);

CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"source" "transaction_source" NOT NULL,
	"execution_id" uuid REFERENCES "executions"("id") ON DELETE SET NULL,
	"system_id" uuid REFERENCES "systems"("id") ON DELETE SET NULL,
	"tx_hash" text,
	"status" "tx_status" DEFAULT 'PENDING' NOT NULL,
	"block_number" bigint,
	"source_asset" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"destination_asset" text NOT NULL REFERENCES "asset_registry"("asset_id"),
	"amount_in" numeric(38, 18),
	"amount_out" numeric(38, 18),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "transactions_tx_hash_idx" ON "transactions" ("tx_hash");
CREATE INDEX "transactions_wallet_timestamp_idx" ON "transactions" ("wallet_address","timestamp");

CREATE TABLE "nexus_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid REFERENCES "systems"("id") ON DELETE SET NULL,
	"status" "nexus_permission_status" DEFAULT 'CREATED' NOT NULL,
	"scope" jsonb NOT NULL,
	"session_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);

CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "chat_messages_chat_id_created_at_idx" ON "chat_messages" ("chat_id","created_at");

CREATE TABLE "chat_compacted_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL REFERENCES "chats"("id") ON DELETE CASCADE,
	"summary" text NOT NULL,
	"covers_up_to_message_id" uuid REFERENCES "chat_messages"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "chat_compacted_context_chat_id_created_at_idx" ON "chat_compacted_context" ("chat_id","created_at");

CREATE TABLE "memory_summary" (
	"wallet_address" text PRIMARY KEY NOT NULL REFERENCES "users"("wallet_address") ON DELETE CASCADE,
	"summary" text DEFAULT '' NOT NULL,
	"memory_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "high_impact_news_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"country" text NOT NULL,
	"event_type" text NOT NULL,
	"impact_level" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "high_impact_news_events_event_timestamp_idx" ON "high_impact_news_events" ("event_timestamp");
