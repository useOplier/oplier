import { config } from "dotenv";
config();
import { z } from "zod";

/**
 * Worker environment configuration.
 *
 * Mirrors `apps/api/src/config/env.ts` deliberately — same `dotenv` main-export call at import
 * time (tsx does not load `.env` automatically), same fail-fast-at-startup Zod parse, same cached
 * accessor. A worker that boots with a half-valid config and then fails on its first swap hours
 * later is far worse to debug than one that refuses to start, and doc 08 §11 requires all of this
 * to be server-side env config rather than anything committed.
 *
 * `.env` is read from `process.cwd()`, which `pnpm --filter @oplier/worker run <script>` sets to
 * `apps/worker/` — that is the authoritative location for this package's env file.
 */

/**
 * Monitoring cadence (doc 08 §5 / brief responsibility #5, LOCKED):
 *   - price / price-percentage / ROI : 5-10s
 *   - HIGH_IMPACT_NEWS              : 60s
 * Both are engine-level configuration, never per-System (doc 04 §17: "The monitoring interval is
 * engine-level configuration, not a per-System setting"), which is why they live here as process
 * env rather than on any System row.
 *
 * The 5-10s bound is enforced, not merely documented: a value outside it is a config error, since
 * tightening it further would hammer the price cache and DB on a t3.small (doc 08 §3, ~1GiB
 * available), and loosening it would violate the locked cadence. Note this OVERRIDES doc 05 §17's
 * original 60s price cycle — the brief's override is explicit and newer.
 */
const PRICE_CYCLE_MIN_MS = 5_000;
const PRICE_CYCLE_MAX_MS = 10_000;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // --- Database (doc 08 §5, shared with apps/api) ---
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // --- Monitoring cadence (locked; see note above) ---
  PRICE_CYCLE_MS: z.coerce
    .number()
    .int()
    .min(PRICE_CYCLE_MIN_MS, `PRICE_CYCLE_MS must be >= ${PRICE_CYCLE_MIN_MS} (locked 5-10s cadence)`)
    .max(PRICE_CYCLE_MAX_MS, `PRICE_CYCLE_MS must be <= ${PRICE_CYCLE_MAX_MS} (locked 5-10s cadence)`)
    .default(7_000),
  NEWS_CYCLE_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * TIME conditions. Not one of the two locked cadences — the engine added its own timer for it
   * (`engine-loop.ts`) because nothing else drives a TIME condition. 30s is enough resolution for
   * a condition whose parameter is HH:MM.
   */
  TIME_CYCLE_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * Activation/revocation reconciler cadence (`permissions/activation-reconciler.ts`). Not a
   * condition-evaluation cycle: it drains the authorization queues `apps/api` writes, since only this
   * process holds the owner signer and session-key seed.
   *
   * This interval is the user-visible latency between "System created" and "System ACTIVE", and it is
   * also the upper bound on how long a deleted System's session key stays live on-chain — so it wants
   * to be short. 15s is well clear of the two locked price cadences and cheap, because a cycle with
   * both queues empty is two indexed queries that return nothing.
   */
  ACTIVATION_CYCLE_MS: z.coerce.number().int().positive().default(15_000),

  // --- Receipt polling (doc 05 §15) ---
  RECEIPT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  RECEIPT_MAX_WAIT_MS: z.coerce.number().int().positive().default(45_000),

  // --- Chain / RPC (doc 08 §11) ---
  /**
   * X Layer testnet chain id. 1952 (0x7A0) is confirmed against both OKX's official RPC page and
   * Alchemy's chain resource page (master plan §1, FINDINGS.md §1). Mainnet is 196 — never reuse
   * the testnet id there.
   */
  CHAIN_ID: z.coerce.number().int().positive().default(1952),
  /**
   * Primary RPC. OKX publishes two official, interchangeable X Layer testnet endpoints, and BOTH
   * require the `/terigon` path suffix — a URL missing it is not a working endpoint (master plan
   * §1, stated explicitly there because it is easy to drop).
   */
  XLAYER_RPC_URL: z.string().url("XLAYER_RPC_URL must be a full URL"),
  /** Fallback RPC — the second official endpoint. Redundant/load-balanced, not a different tier. */
  XLAYER_RPC_URL_FALLBACK: z.string().url().optional(),

  // --- Pyth (doc 05 §5) ---
  PYTH_HERMES_ENDPOINT: z.string().url().default("https://hermes.pyth.network"),
  /**
   * Comma-separated `asset_registry.asset_id` values to stream prices for. Defaults to the four
   * mock RWA assets; USDG is deliberately absent because it has no confirmed Pyth feed and is
   * served by the peg-check path instead (see data-layer's feed-registry.ts).
   */
  PYTH_STREAM_ASSETS: z
    .string()
    .default("test_aapl,test_meta,test_nvda,test_gold")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  /** Freshness threshold for price staleness (doc 05 §6). Defaults to data-layer's own 15s. */
  PRICE_FRESHNESS_THRESHOLD_MS: z.coerce.number().int().positive().default(15_000),

  // --- Alchemy Smart Wallets (doc 08 §11) ---
  ALCHEMY_API_KEY: z.string().min(1, "ALCHEMY_API_KEY is required"),
  /**
   * The dashboard-created Gas Manager sponsorship policy id. Must be the existing policy, not one
   * created programmatically (Part E brief: "integrate that same capability programmatically, not
   * recreate it from scratch").
   */
  ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET: z
    .string()
    .min(1, "ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET is required"),
  /**
   * Private key of the account that owns the smart accounts and signs session grants.
   *
   * doc 08 §11: server-side only, never committed, never in frontend code. This is the single
   * most sensitive value the worker holds — see DEPLOYMENT_RUNBOOK.md's secrets section.
   */
  SMART_ACCOUNT_OWNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "SMART_ACCOUNT_OWNER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key"),
  /**
   * Master seed from which every System's session key is DERIVED deterministically
   * (see `session-keys.ts`). This exists so the worker never has to persist per-System private
   * keys: after a restart it re-derives the same session key for a given systemId and can keep
   * signing for sessions granted before the restart. Rotating this seed orphans every existing
   * session key — see the runbook before touching it.
   */
  SESSION_KEY_MASTER_SEED: z
    .string()
    .min(32, "SESSION_KEY_MASTER_SEED must be at least 32 characters — it derives every session key"),

  // --- AMM (doc 08 §11) ---
  /**
   * Optional override for Part K's deployed Router. Left unset in normal operation: the address is
   * a confirmed public constant in both `@oplier/permissions` (chain.ts) and
   * `@oplier/amm-execution` (config/deployment.ts), so overriding it here means pointing at a
   * different deployment and should be deliberate.
   */
  AMM_ROUTER_ADDRESS_OVERRIDE: z.string().optional(),

  // --- Operational ---
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /**
   * When true the worker evaluates conditions and logs what it WOULD do, but never submits a
   * transaction. Intended for the first boot against a live DB, so a misconfiguration surfaces
   * before real funds move.
   */
  DRY_RUN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /**
   * Whether to ask Alchemy's Gas Manager to sponsor userop gas.
   *
   * Defaults to TRUE, and that is the correct long-term value: sponsorship is a solid part of the
   * product on BOTH testnet and mainnet. A System's session key holds no funds of its own, so
   * sponsored gas is what lets an autonomous UPM execute without the user pre-funding a key. Do not
   * "fix" a broken environment by flipping this default.
   *
   * ── OPEN BUG (2026-08-20): our sponsored requests come back with zero gas ──────────────────────
   * Observed on X Layer testnet: `prepareCalls` WITH `capabilities.paymasterService` returns
   * `feePayment: { sponsored: true, maxAmount: "0x0" }` and `preVerificationGas: 0`,
   * `maxFeePerGas: 0`; the bundler then rejects the userop with
   * `precheck failed: preVerificationGas is 0 but must be at least 35163`. The identical request
   * WITHOUT `paymasterService` returns real estimates and lands on-chain.
   *
   * That narrows the fault to the sponsorship request/policy, NOT to chain support — chain 1952 is
   * clearly served by the bundler. Sponsorship is known to work on this testnet, so this is a
   * configuration or request-shape defect on our side, still to be diagnosed. Candidates worth
   * checking, roughly in order:
   *   - whether `ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET` is a Wallet-API-compatible policy and
   *     is scoped to chain 1952 (a policy created for another network returns sponsored-but-empty
   *     rather than erroring);
   *   - whether the policy belongs to the same Alchemy app as `ALCHEMY_API_KEY`;
   *   - whether the policy's spending rules / allowlist admit this sender and the Router target;
   *   - whether this SDK version expects the capability under a different key or with an
   *     `entryPoint`/`policyId` shape we are not sending.
   *
   * ⚠ TEMPORARY: `apps/worker/.env` currently overrides this to `false` purely to unblock testing of
   * the rest of the UPM pipeline. That override makes the SMART ACCOUNT PAY ITS OWN GAS, so it needs
   * a native OKB balance (an unfunded account fails with an AA21-style prefund error). Both the
   * override and that funding requirement must be removed once the bug above is fixed.
   */
  GAS_SPONSORSHIP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type WorkerEnv = z.infer<typeof envSchema>;

let cachedEnv: WorkerEnv | undefined;

export function loadEnv(): WorkerEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid worker environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid worker environment configuration — see above for details.");
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
