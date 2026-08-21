import { setDefaultResultOrder } from "node:dns";
import { loadEnv } from "./config/env.js";
import { buildRuntime } from "./runtime.js";
import { runPreflight } from "./preflight.js";

/**
 * Prefer IPv4 when resolving dual-stack hosts.
 *
 * Node has defaulted to "verbatim" DNS order since v17, which means the AAAA record is tried first.
 * On a host with no IPv6 default route every one of those attempts is doomed: measured here,
 * `curl -6` to Hermes fails outright while `curl -4` returns 200 in 1.8s, and `ip -6 route show
 * default` is empty. The doomed attempts are not merely slow — they surface as `read ENETUNREACH`
 * unhandled rejections from inside EventSource, which is what repeatedly killed this worker.
 *
 * Hermes sits behind Cloudflare and is dual-stack, so this affects every price-stream connect. Set
 * before any client is constructed. Harmless where IPv6 does work: it only reorders preference.
 */
setDefaultResultOrder("ipv4first");

/**
 * Deadline for one activation-reconciler cycle. ~4x the ~45s a real Alchemy grant measured at, so a
 * merely slow cycle finishes normally and only a genuinely stuck one is abandoned — see the race in
 * `runReconcileCycle` for why abandoning it matters and why the bound has to be this generous.
 */
const ACTIVATION_CYCLE_TIMEOUT_MS = 180_000;

/**
 * Worker entry point.
 *
 * This is a LONG-RUNNING PROCESS, not a request handler (doc 08 §4 is explicit: the model is
 * "Pyth price update -> UPM worker -> evaluate conditions -> execute", never "Vercel request ->
 * wait for condition -> execute later"). It holds an open Pyth stream and four interval timers for
 * the lifetime of the process (three condition cycles plus the activation reconciler), and expects to be supervised by systemd with automatic restart
 * (doc 08 §10). Structured to mirror `apps/api/src/server.ts`: load env, build, start, install
 * signal handlers for graceful shutdown.
 *
 * Ordering at startup matters and is deliberate:
 *   1. Preflight — abort before doing anything if a feed id is wrong, the schema drifted, or the RPC
 *      points at the wrong chain. Starting anyway would mean a worker that appears healthy while
 *      silently never firing a condition.
 *   2. Resolve the owner smart account — needed for owner-authority calls (revocation).
 *   3. Start the price stream, and only then the evaluation loop, so the first tick has a chance of
 *      finding fresh prices rather than logging staleness for every asset.
 *   4. Start the activation reconciler, which grants permissions for Systems the API left in
 *      AUTHORIZATION_REQUIRED and revokes keys whose System was deleted. Started last because it is
 *      the only cycle that writes to the chain, so nothing else should be mid-initialisation when the
 *      first grant goes out. It runs one cycle immediately rather than waiting a full interval, so a
 *      restart does not strand a pending activation for ACTIVATION_CYCLE_MS.
 */

async function main(): Promise<void> {
  const env = loadEnv();
  const runtime = buildRuntime(env);
  const { logger } = runtime;

  logger.info("worker_starting", {
    chainId: env.CHAIN_ID,
    priceCycleMs: env.PRICE_CYCLE_MS,
    newsCycleMs: env.NEWS_CYCLE_MS,
    timeCycleMs: env.TIME_CYCLE_MS,
    activationCycleMs: env.ACTIVATION_CYCLE_MS,
    dryRun: env.DRY_RUN,
    nodeVersion: process.version,
  });

  // ── 1. Preflight ───────────────────────────────────────────────────────────
  // `runtime.db` is passed deliberately: letting runPreflight open its own pool leaks a second
  // set of connections for the life of this process. See runPreflight's @param note.
  const preflight = await runPreflight(env, logger, runtime.db);
  for (const w of preflight.warnings) logger.warn("preflight_warning", { detail: w });
  if (!preflight.ok) {
    for (const f of preflight.hardFailures) logger.error("preflight_failure", { detail: f });
    logger.error("worker_start_aborted", {
      reason: "preflight failed — refusing to start rather than run without working price data",
    });
    await runtime.shutdown();
    // Exit non-zero so systemd's Restart=on-failure retries with backoff. A misconfiguration will
    // keep failing, which is the correct visible outcome — see DEPLOYMENT_RUNBOOK.md.
    process.exit(1);
  }

  // ── 2. Owner smart account (needed before any revocation) ──────────────────
  try {
    await runtime.initOwnerSmartAccount();
  } catch (err) {
    // Non-fatal: everything except on-chain revocation works without it, and revocation already
    // fails loudly and safely (it simulates first). Better a degraded worker that monitors than no
    // worker at all.
    logger.error("owner_smart_account_unresolved", {
      err,
      detail:
        "On-chain revocation will fail until this resolves; the DB-status gate still blocks execution " +
        "for deleted/paused Systems.",
    });
  }

  // ── 2b. Release execution locks abandoned by a previous process ───────────
  // Must run BEFORE the loop starts, otherwise the first tick defers to a dead attempt. See
  // `recoverAbandonedExecutionLocks` for why this cannot double-submit.
  try {
    const recovered = await runtime.repository.recoverAbandonedExecutionLocks();
    if (recovered > 0) {
      logger.warn("execution_locks_recovered", {
        count: recovered,
        detail:
          "Reset EXECUTING executions that had no txHash — a previous worker died after claiming the " +
          "lock but before submitting. Without this they would never retry.",
      });
    }
  } catch (err) {
    // Non-fatal: a failure here costs a stuck System, not a wrong transaction.
    logger.error("execution_lock_recovery_failed", { err });
  }

  // ── 3. Price stream, then the evaluation loop ─────────────────────────────
  runtime.priceAdapter.startStreaming(runtime.streamedAssets);
  logger.info("price_stream_started", { assets: runtime.streamedAssets });

  /**
   * REST backstop behind the SSE stream. The stream stays the primary path (doc 05 §5); this only
   * guarantees a floor on write cadence.
   *
   * WHY: the stream was observed delivering one burst on connect and then going quiet — all four
   * assets sharing a byte-identical `observed_at` gave it away, since independent Pyth feeds never
   * publish in lockstep. `asset_prices` then went minutes (overnight, 17+ hours) without a write while
   * staleness is measured against wall clock, so every price condition evaluated false on staleness
   * and no System ever fired. Nothing logged it, because "stale" is not an error.
   *
   * Runs at the price cycle's own cadence and is re-entrancy guarded, so a slow REST round trip cannot
   * pile up overlapping refreshes.
   */
  let refreshInFlight = false;
  const priceRefreshTimer = setInterval(() => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    runtime.priceAdapter
      .refreshLatestPrices(runtime.streamedAssets)
      .catch((err) => logger.warn("price_refresh_failed", { err }))
      .finally(() => {
        refreshInFlight = false;
      });
  }, env.PRICE_CYCLE_MS);

  runtime.loop.start();

  // ── 4. Activation / revocation reconciler ─────────────────────────────────
  /**
   * Re-entrancy guard. A grant is a multi-round-trip vendor call that measured ~45s against Alchemy
   * on X Layer testnet — far longer than ACTIVATION_CYCLE_MS (15s default). Without this guard the
   * next interval fires while the previous cycle is still awaiting the grant, both cycles read the
   * same System as AUTHORIZATION_REQUIRED, and both call `activate()`. Observed live: one System
   * ended up with TWO `CREATED` nexus_permissions rows, i.e. two live session keys, each carrying its
   * own spend limit. Only one can be `findCurrentForSystem`'s answer, so the other becomes an
   * untracked key that deletion will never revoke — exactly the orphan class DEPLOYMENT_RUNBOOK.md §5
   * warns about, and a violation of doc 02's one-permission-per-System model.
   *
   * Skipping (rather than queueing) the overlapping tick is correct: the work is idempotent
   * queue-draining, so the next tick picks up anything this one misses.
   */
  let reconcileInFlight = false;
  const runReconcileCycle = async (): Promise<void> => {
    if (reconcileInFlight) {
      logger.warn("activation_cycle_skipped", {
        detail: "previous cycle still in flight — skipping this tick to avoid a duplicate grant",
      });
      return;
    }
    reconcileInFlight = true;
    try {
      /**
       * The grant is raced against a deadline so a hung vendor call cannot kill activation forever.
       *
       * THE BUG THIS FIXES: `reconcileInFlight` is only cleared in the `finally` below, which requires
       * `runOnce()` to settle. A grant is a multi-round-trip Alchemy call with no timeout of its own,
       * so if it hangs the flag stays true for the life of the process and EVERY later tick returns at
       * the guard above. Observed live: 209 consecutive `activation_cycle_skipped` and no System ever
       * activating again. For a UPM created in the UI that means it sits in AUTHORIZATION_REQUIRED
       * forever with nothing logged as an error — the app just looks broken.
       *
       * The deadline is deliberately ~4x the ~45s a real grant measured at. Releasing the flag while a
       * grant is genuinely still in flight would risk the duplicate grant this guard exists to prevent
       * (two CREATED nexus_permissions rows = an untracked session key), so the bound has to be far
       * above the real worst case: a slow cycle must still be allowed to finish normally, and only a
       * genuinely stuck one gets abandoned.
       */
      const result = await Promise.race([
        runtime.activationReconciler.runOnce(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`activation cycle exceeded ${ACTIVATION_CYCLE_TIMEOUT_MS}ms`)),
            ACTIVATION_CYCLE_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      // Only log when the cycle actually did something — this fires every ACTIVATION_CYCLE_MS and an
      // idle deployment would otherwise bury the log in no-ops.
      if (result.granted || result.regranted || result.revoked || result.failed) {
        logger.info("activation_cycle", { ...result });
      }
    } catch (err) {
      // Matches the EngineLoop error policy: swallow and log. A reconciler crash must not take down
      // condition monitoring for every other System.
      logger.error("activation_cycle_error", { err });
    } finally {
      reconcileInFlight = false;
    }
  };

  await runReconcileCycle();
  const activationTimer = setInterval(() => void runReconcileCycle(), env.ACTIVATION_CYCLE_MS);
  // Do not hold the event loop open on this timer alone; the Pyth stream is what keeps us alive.
  activationTimer.unref();

  logger.info("worker_started", {
    detail: "monitoring active — price/ROI, news, and time cycles running; activation reconciler armed",
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  let shuttingDown = false;

  /**
   * Hard ceiling on teardown. `runtime.shutdown()` awaits in-flight work, and if any of it never
   * settles the `process.exit(0)` below is never reached.
   *
   * THE BUG THIS FIXES: that hang produced an immortal worker. `worker_stopping` was logged, the DB
   * pool was closed, and then every still-running cycle spun on the dead pool emitting
   * `write CONNECTION_ENDED` — ~1MB of log per 4 minutes, forever. Worse, the `shuttingDown` guard
   * below made every subsequent SIGTERM a no-op, so the process could only be removed with SIGKILL.
   * Twice this session a "running" worker was actually this zombie, doing no work at all.
   *
   * `unref()` so the watchdog itself never keeps the process alive when shutdown does succeed.
   */
  const SHUTDOWN_GRACE_MS = 10_000;
  const armExitWatchdog = (): void => {
    setTimeout(() => {
      logger.error("shutdown_timed_out", {
        graceMs: SHUTDOWN_GRACE_MS,
        detail: "teardown did not finish in time — forcing exit rather than leaving a zombie that logs forever",
      });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
  };

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      // A second signal means the operator asked twice. Honour it immediately instead of returning
      // and leaving them with a process that ignores SIGTERM.
      logger.warn("shutdown_forced", { signal, detail: "second signal during teardown — exiting now" });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("worker_stopping", { signal });
    armExitWatchdog();
    try {
      clearInterval(activationTimer);
      clearInterval(priceRefreshTimer);
      await runtime.shutdown();
      logger.info("worker_stopped", {});
      process.exit(0);
    } catch (err) {
      logger.error("shutdown_failed", { err });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  /**
   * Transient socket faults that must NOT take the worker down.
   *
   * A long-lived SSE connection to Hermes gets reset as a matter of course, and the reset surfaces here
   * as an unhandled rejection from inside the EventSource implementation rather than at any awaitable
   * call site. Treating that as fatal meant a routine network blip killed the worker — and because
   * preflight takes ~2 minutes (the AMM check alone is ~81s), each restart is 2 minutes with no
   * monitoring at all. The price stream now has its own reconnect watchdog
   * (`hermes-stream-client.ts#staleTimeoutMs`), so the recovery path for exactly these codes already
   * exists and is better than a process bounce.
   *
   * Anything NOT in this set keeps the original fatal behaviour: log and exit for a supervisor to
   * restart, because continuing in an unknown state while holding spending authority is worse.
   */
  const TRANSIENT_NETWORK_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "ENOTFOUND",
    "EAI_AGAIN",
    "UND_ERR_SOCKET",
    // Host/network unreachable. `ENETUNREACH` is NOT hypothetical: it is what every IPv6 connect
    // attempt returns on a host with no IPv6 route, and it killed the worker once even after the
    // classification above was added, because it was missing from this set.
    "ENETUNREACH",
    "EHOSTUNREACH",
  ]);

  const transientCodeOf = (reason: unknown): string | null => {
    const code = (reason as { code?: unknown })?.code;
    if (typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code)) return code;
    const message = reason instanceof Error ? reason.message : "";
    if (message.includes("socket hang up") || message.includes("other side closed")) return "SOCKET_HANG_UP";
    return null;
  };

  process.on("unhandledRejection", (reason) => {
    const transient = transientCodeOf(reason);
    if (transient) {
      logger.warn("transient_rejection_ignored", {
        code: transient,
        detail: "network fault, not fatal — the price stream watchdog reconnects on its own",
        err: reason,
      });
      return;
    }
    logger.error("unhandled_rejection", { err: reason });
    void shutdown("unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger.error("uncaught_exception", { err });
    void shutdown("uncaughtException");
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
