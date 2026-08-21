import { HermesClient } from "@pythnetwork/hermes-client";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PYTH_FEED_REGISTRY, resolveFeedIdFromLocalRegistry } from "@oplier/data-layer";
import { getTokenConfig, POOLS, AMM_CORE } from "@oplier/amm-execution";
import { loadEnv, type WorkerEnv } from "./config/env.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createChainClient } from "./chain/chain-reader.js";
import { DrizzleSystemRepository } from "./repositories/system-repository.js";
import { createDb, closeDb, type Database } from "@oplier/db";

/**
 * Startup preflight.
 *
 * This exists because several things this worker depends on are documented as UNVERIFIED by the
 * packages that own them, and every one of them fails silently or confusingly at runtime rather than
 * loudly at boot:
 *
 *   - Pyth feed IDs were originally transcribed from training data rather than confirmed against
 *     Pyth's live registry, and three of the five were wrong. They were verified live on 2026-08-19
 *     and this check is what caught them, so keep it: a bad feed id means that asset's price simply
 *     never arrives, so its conditions silently never fire — the worst possible failure mode for a
 *     system that moves money on price triggers. Note the shape check alone is not sufficient — the
 *     three bad ids were caught only because they happened to be 63 chars; a 64-char wrong id passes
 *     shape and is caught further down by the Hermes existence check.
 *   - The DB schema has never been exercised by the real Drizzle repositories.
 *   - The RPC endpoint requires a `/terigon` path suffix that is easy to drop.
 *   - Three of four AMM pools are unseeded, so swaps against them are expected to fail.
 *
 * Run it as `pnpm --filter @oplier/worker run preflight`, and note that `main.ts` runs the same
 * checks on boot: a hard failure aborts startup rather than letting the worker sit there evaluating
 * nothing. Soft warnings are logged and allowed through.
 */

export interface PreflightResult {
  ok: boolean;
  hardFailures: string[];
  warnings: string[];
}

/** Feed ids must be 64 hex chars (32 bytes). Catches truncated/garbled ids, but NOT a wrong id of
 *  the right length — the Hermes existence check below is what catches those. */
function isWellFormedFeedId(feedId: string): boolean {
  const stripped = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  return /^[0-9a-fA-F]{64}$/.test(stripped);
}

/**
 * @param db Optional shared `@oplier/db` instance. PASS THIS from a long-running process: without it
 *   this function opens a SECOND connection pool (up to 10 connections) alongside the one
 *   `runtime.ts` already owns, and that pool is never released for the life of the process. Against
 *   Supabase's pgbouncer pooler that is enough — combined with the API's pool and any restart loop —
 *   to exhaust client connections, after which queries hang instead of failing. Only the standalone
 *   CLI below should let this default, and it closes what it opens.
 */
export async function runPreflight(
  env: WorkerEnv,
  logger: Logger,
  db?: Database,
): Promise<PreflightResult> {
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  // Opened only when the caller supplied nothing, and closed in the `finally` below.
  const ownedDb: Database | undefined = db ? undefined : createDb(env.DATABASE_URL);

  // ── 1. Pyth feed ids: shape, then existence against the live registry ──────
  const hermes = new HermesClient(env.PYTH_HERMES_ENDPOINT);
  const feedsToCheck: Array<{ assetId: string; feedId: string }> = [];

  for (const assetId of env.PYTH_STREAM_ASSETS) {
    const entry = resolveFeedIdFromLocalRegistry(assetId);
    if (!entry) {
      hardFailures.push(
        `PYTH_STREAM_ASSETS lists "${assetId}", which has no entry in PYTH_FEED_REGISTRY. ` +
          `Known keys: ${Object.keys(PYTH_FEED_REGISTRY).join(", ")}`,
      );
      continue;
    }
    if (!entry.feedId) {
      warnings.push(
        `Asset "${assetId}" has an empty feedId (expected for USDG, which uses the peg-check path) — ` +
          `it will not be streamed.`,
      );
      continue;
    }
    if (!isWellFormedFeedId(entry.feedId)) {
      hardFailures.push(
        `Asset "${assetId}" has a malformed Pyth feed id (${entry.feedId.length} chars, expected 64 hex). ` +
          `Look it up at pyth.network/price-feeds or Hermes /v2/price_feeds and correct ` +
          `PYTH_FEED_REGISTRY in packages/data-layer.`,
      );
      continue;
    }
    feedsToCheck.push({ assetId, feedId: entry.feedId });
  }

  if (feedsToCheck.length > 0) {
    try {
      // One call for all ids. `ignoreInvalidPriceIds` so a bad id is reported as absent rather than
      // rejecting the batch, which is what lets us name exactly which asset is wrong.
      const update = await hermes.getLatestPriceUpdates(
        feedsToCheck.map((f) => f.feedId),
        { parsed: true, ignoreInvalidPriceIds: true },
      );
      const returned = new Set(
        ((update.parsed ?? []) as Array<{ id: string }>).map((p) =>
          p.id.startsWith("0x") ? p.id.slice(2).toLowerCase() : p.id.toLowerCase(),
        ),
      );
      for (const feed of feedsToCheck) {
        const normalized = feed.feedId.toLowerCase();
        if (!returned.has(normalized)) {
          hardFailures.push(
            `Pyth does not recognise the feed id configured for "${feed.assetId}" (${feed.feedId}). ` +
              `Look it up at pyth.network/price-feeds or Hermes /v2/price_feeds and correct ` +
              `PYTH_FEED_REGISTRY in packages/data-layer.`,
          );
        } else {
          logger.info("preflight_feed_ok", { assetId: feed.assetId });
        }
      }
    } catch (err) {
      // Network failure is not the same as a bad id — don't block startup on Hermes being briefly
      // unreachable, since the stream client retries on its own.
      warnings.push(
        `Could not reach Pyth Hermes to verify feed ids (${String(err)}). Feed ids remain UNVERIFIED.`,
      );
    }
  }

  // ── 2. Database: real queries through the real repositories ────────────────
  try {
    const repository = new DrizzleSystemRepository(db ?? ownedDb!);
    const active = await repository.listActiveSystems();
    logger.info("preflight_db_ok", { activeSystems: active.length });

    // Exercise a read that touches the joins the hot path uses, so a schema drift in steps/swaps
    // surfaces now rather than on the first trigger.
    const assets = await repository.listAssetsInActiveSystems();
    logger.info("preflight_db_assets", { assetCount: assets.length, assets });

    // Any asset referenced by an ACTIVE System but not streamed will never evaluate a price
    // condition. That is a silent no-op in production, so it is worth a loud warning.
    const streamed = new Set(env.PYTH_STREAM_ASSETS);
    const unstreamed = assets.filter((a) => !streamed.has(a) && a !== "test_usdg");
    if (unstreamed.length > 0) {
      warnings.push(
        `ACTIVE Systems reference asset(s) not in PYTH_STREAM_ASSETS: ${unstreamed.join(", ")}. ` +
          `Their price/ROI conditions will never fire. Add them to PYTH_STREAM_ASSETS.`,
      );
    }

    const orphaned = await repository.listOrphanedActivePermissions();
    if (orphaned.length > 0) {
      warnings.push(
        `${orphaned.length} nexus_permissions row(s) are still CREATED but their System is deleted. ` +
          `These session keys may still be valid on-chain — see DEPLOYMENT_RUNBOOK.md.`,
      );
    }
  } catch (err) {
    hardFailures.push(`Database preflight failed: ${String(err)}`);
  }

  // ── 3. RPC reachability + chain id ────────────────────────────────────────
  if (!env.XLAYER_RPC_URL.includes("/terigon")) {
    // Both official OKX testnet endpoints require this suffix; a URL without it is not a working
    // endpoint (master plan §1 calls this out explicitly).
    warnings.push(
      `XLAYER_RPC_URL does not contain "/terigon". Both official OKX X Layer testnet endpoints ` +
        `require that path suffix — verify this is intentional.`,
    );
  }
  try {
    const client = createChainClient({
      rpcUrl: env.XLAYER_RPC_URL,
      fallbackRpcUrl: env.XLAYER_RPC_URL_FALLBACK,
      chainId: env.CHAIN_ID,
    });
    const [chainId, blockNumber] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    if (chainId !== env.CHAIN_ID) {
      hardFailures.push(
        `RPC reports chain id ${chainId} but CHAIN_ID is ${env.CHAIN_ID}. Refusing to start — ` +
          `submitting to the wrong chain is not recoverable.`,
      );
    } else {
      logger.info("preflight_rpc_ok", { chainId, blockNumber: Number(blockNumber) });
    }
  } catch (err) {
    hardFailures.push(`RPC preflight failed for ${env.XLAYER_RPC_URL}: ${String(err)}`);
  }

  // ── 4. AMM pool liquidity ─────────────────────────────────────────────────
  const seeded = Object.values(POOLS).filter((p) => p.status === "SEEDED");
  const empty = Object.values(POOLS).filter((p) => p.status === "EMPTY");
  if (seeded.length === 0) {
    hardFailures.push("No AMM pool is marked SEEDED — every swap would fail pre-submission.");
  }
  if (empty.length > 0) {
    warnings.push(
      `${empty.length} AMM pool(s) are unseeded and will reject swaps pre-submission: ` +
        `${empty.map((p) => p.assetId).join(", ")}. Only ${seeded.map((p) => p.assetId).join(", ")} is tradeable.`,
    );
  }
  logger.info("preflight_amm", { router: AMM_CORE.router, seeded: seeded.map((p) => p.assetId) });

  // ── 5. Spend-limit asset must be resolvable (decimals matter) ─────────────
  const usdg = getTokenConfig("test_usdg");
  if (!usdg) {
    hardFailures.push("test_usdg has no token config — spend limits cannot be denominated.");
  } else if (usdg.decimals !== 6) {
    warnings.push(`test_usdg decimals is ${usdg.decimals}, expected 6 — verify against the real token.`);
  }

  if (env.DRY_RUN) {
    warnings.push("DRY_RUN is enabled — conditions will be evaluated but NO transaction will be submitted.");
  }

  if (ownedDb) await closeDb(ownedDb);

  return { ok: hardFailures.length === 0, hardFailures, warnings };
}

/** CLI entry: `pnpm --filter @oplier/worker run preflight`. */
async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, { app: "oplier-worker", phase: "preflight" });
  const result = await runPreflight(env, logger);

  for (const w of result.warnings) logger.warn("preflight_warning", { detail: w });
  for (const f of result.hardFailures) logger.error("preflight_failure", { detail: f });

  if (!result.ok) {
    logger.error("preflight_failed", { failures: result.hardFailures.length });
    process.exit(1);
  }
  logger.info("preflight_passed", { warnings: result.warnings.length });
  process.exit(0);
}

// Only run as a CLI when this file is the process entry point, so `main.ts` can import
// `runPreflight` without triggering a `process.exit`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
