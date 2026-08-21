import { createDb, closeDb, type Database } from "@oplier/db";
import {
  DEFAULT_ENGINE_LOOP_CONFIG,
  EngineLoop,
  UpmEngine,
  type EngineLoopConfig,
} from "@oplier/engine";
import {
  HinNewsDataProviderAdapter,
  PythAdapter,
  resolveFeedIdFromLocalRegistry,
} from "@oplier/data-layer";
import {
  AlchemyPermissionService,
  SystemPermissionLifecycle,
  deriveEntityId,
  toEngineAdapter,
  xLayerTestnet,
  type SystemStatusReader,
} from "@oplier/permissions";
import {
  AmmSwapExecutor,
  InMemoryRunStartBalanceStore,
  getTokenConfig,
} from "@oplier/amm-execution";
import { alchemy } from "@account-kit/infra";
import { createSmartWalletClient, signPreparedCalls } from "@account-kit/wallet-client";
/**
 * `getDefaultSingleSignerValidationModuleAddress` lives on the `/experimental` subpath (the ma-v2
 * export), not the package root.
 *
 * Worth knowing when reading the revocation path: that helper returns the SAME CREATE2-deterministic
 * address for every chain — X Layer is not specially cased, it falls through to the default
 * `0x0000...7d83`. That is consistent with FINDINGS.md §3's note that smart-account contract
 * addresses are identical across EVM chains, but it does NOT prove the module is actually deployed
 * on X Layer testnet. Another item for the live run.
 */
import { getDefaultSingleSignerValidationModuleAddress } from "@account-kit/smart-contracts/experimental";
import { LocalAccountSigner } from "@aa-sdk/core";
import { privateKeyToAccount } from "viem/accounts";

import type { WorkerEnv } from "./config/env.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { createChainClient, ViemChainReader } from "./chain/chain-reader.js";
import { viemCalldataEncoder } from "./chain/viem-seams.js";
import { RealHermesStreamClient } from "./pyth/hermes-stream-client.js";
import { DerivedSessionKeyProvider } from "./permissions/session-keys.js";
import { ActivationReconciler } from "./permissions/activation-reconciler.js";
import { AlchemySessionKeySender } from "./permissions/session-key-sender.js";
import { Erc6900SessionRevoker } from "./permissions/on-chain-revoker.js";
import { RouterAllowanceEnsurer } from "./execution/router-allowance.js";
import { DrizzleSystemRepository } from "./repositories/system-repository.js";
import { DrizzlePriceRepository } from "./repositories/price-repository.js";
import { DrizzleNewsRepository } from "./repositories/news-repository.js";
import {
  DrizzleNexusPermissionRepository,
  DrizzlePermissionContextResolver,
  DrizzleSessionMetadataStore,
} from "./repositories/permission-repository.js";
import { ReconcilingSwapExecutor } from "./execution/reconciling-swap-executor.js";

/**
 * Composition root. Every real dependency is constructed exactly once, here, and injected — no
 * module reaches into `process.env` on its own except `config/env.ts`, and nothing constructs its own
 * DB client (that is why `@oplier/db` exposes `createDb`).
 *
 * This is where the brief's core deliverable actually happens: the engine is instantiated with the
 * real Part D price provider, the real Part E permission service, and the real Part F swap executor.
 * No mock from any package is imported anywhere in `apps/worker`.
 */

export interface WorkerRuntime {
  db: Database;
  engine: UpmEngine;
  loop: EngineLoop;
  logger: Logger;
  repository: DrizzleSystemRepository;
  priceAdapter: PythAdapter;
  streamClient: RealHermesStreamClient;
  lifecycle: SystemPermissionLifecycle;
  /**
   * Drains the authorization queues `apps/api` writes (grant pending Systems, revoke keys whose
   * System was deleted). Driven on its own interval by main.ts, not by `loop` — it calls the
   * lifecycle, which this process owns, rather than the engine.
   */
  activationReconciler: ActivationReconciler;
  /** Assets whose prices this process streams. */
  streamedAssets: string[];
  /** Resolves + caches the owner's smart account address. Await once at startup. */
  initOwnerSmartAccount(): Promise<`0x${string}`>;
  shutdown(): Promise<void>;
}

export function buildRuntime(env: WorkerEnv): WorkerRuntime {
  const logger = createLogger(env.LOG_LEVEL, { app: "oplier-worker" });

  // ── Persistence ────────────────────────────────────────────────────────────
  const db = createDb(env.DATABASE_URL);
  const repository = new DrizzleSystemRepository(db);
  const priceRepository = new DrizzlePriceRepository(db);
  const newsRepository = new DrizzleNewsRepository(db);
  const permissionRepository = new DrizzleNexusPermissionRepository(db);

  // ── Part D: real price provider ────────────────────────────────────────────
  const streamClient = new RealHermesStreamClient({ endpoint: env.PYTH_HERMES_ENDPOINT, logger });
  const priceAdapter = new PythAdapter({
    streamClient,
    repository: priceRepository,
    freshnessThresholdMs: env.PRICE_FRESHNESS_THRESHOLD_MS,
    resolveFeedId: resolveFeedIdFromLocalRegistry,
  });
  const newsProvider = new HinNewsDataProviderAdapter(newsRepository);

  // ── Chain access ───────────────────────────────────────────────────────────
  const publicClient = createChainClient({
    rpcUrl: env.XLAYER_RPC_URL,
    fallbackRpcUrl: env.XLAYER_RPC_URL_FALLBACK,
    chainId: env.CHAIN_ID,
  });
  const chainReader = new ViemChainReader(publicClient);

  // ── Part E: real permission service ────────────────────────────────────────
  const ownerAccount = privateKeyToAccount(env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`);
  const ownerSigner = LocalAccountSigner.privateKeyToAccountSigner(
    env.SMART_ACCOUNT_OWNER_PRIVATE_KEY as `0x${string}`,
  );
  const smartWalletClient = createSmartWalletClient({
    transport: alchemy({ apiKey: env.ALCHEMY_API_KEY }),
    chain: env.CHAIN_ID === xLayerTestnet.id ? xLayerTestnet : { ...xLayerTestnet, id: env.CHAIN_ID },
    signer: ownerSigner,
  });

  const sessionKeys = new DerivedSessionKeyProvider(env.SESSION_KEY_MASTER_SEED);
  const sessionMetadataStore = new DrizzleSessionMetadataStore(db, deriveEntityId);

  /**
   * The owner's own smart account address, resolved lazily and cached. Needed by the context
   * resolver for owner-authority calls (revocation). Left null until first resolved so worker
   * startup never blocks on an RPC round trip.
   */
  let ownerSmartAccount: `0x${string}` | null = null;
  const ownerContext = () =>
    ownerSmartAccount ? { accountAddress: ownerSmartAccount, paymasterPolicyId: env.ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET } : null;

  const contextResolver = new DrizzlePermissionContextResolver(sessionMetadataStore, ownerContext);

  const sessionSender = new AlchemySessionKeySender({
    // The SDK's client is broader than the narrow interface the sender declares; the cast is to the
    // subset actually used, which keeps the sender unit-testable without the SDK.
    client: smartWalletClient as unknown as ConstructorParameters<typeof AlchemySessionKeySender>[0]["client"],
    signPreparedCalls: signPreparedCalls as unknown as ConstructorParameters<
      typeof AlchemySessionKeySender
    >[0]["signPreparedCalls"],
    sessionKeys,
    permissionContexts: contextResolver,
    logger,
    dryRun: env.DRY_RUN,
    sponsorGas: env.GAS_SPONSORSHIP_ENABLED,
  });

  const onChainRevoker = new Erc6900SessionRevoker({
    publicClient,
    sender: sessionSender,
    validationModuleAddress: getDefaultSingleSignerValidationModuleAddress(
      env.CHAIN_ID === xLayerTestnet.id ? xLayerTestnet : { ...xLayerTestnet, id: env.CHAIN_ID },
    ) as `0x${string}`,
    logger,
    dryRun: env.DRY_RUN,
  });

  const permissionService = new AlchemyPermissionService({
    client: smartWalletClient as unknown as ConstructorParameters<typeof AlchemyPermissionService>[0]["client"],
    sessionKeys,
    ownerAddressFor: () => ownerAccount.address,
    onChainRevoker,
    chainId: env.CHAIN_ID,
    gasManagerPolicyId: env.ALCHEMY_GAS_MANAGER_POLICY_ID_XLAYER_TESTNET,
    sessionStore: sessionMetadataStore,
    // Token address/decimals come from Part F's registry, which is generated from Part K's real
    // deployment — so the spend limit is denominated correctly (USDG is 6 decimals, RWA tokens 18).
    resolveAssetTokenAddress: async (assetId: string) => {
      const token = getTokenConfig(assetId);
      if (!token) throw new Error(`No token config for assetId "${assetId}" — cannot scope a spend limit`);
      return token.tokenAddress;
    },
    resolveAssetDecimals: async (assetId: string) => {
      const token = getTokenConfig(assetId);
      if (!token) throw new Error(`No token config for assetId "${assetId}" — cannot convert a spend limit`);
      return token.decimals;
    },
  });

  // Defense-in-depth gate: reads live `systems.status` before allowing execution, so a
  // deleted/paused System cannot execute through a session key that is still valid on-chain.
  const systemStatusReader: SystemStatusReader = {
    async getSystemStatus(systemId: string) {
      const system = await repository.getSystem(systemId);
      return system ? system.status : null;
    },
  };
  const lifecycle = new SystemPermissionLifecycle(permissionService, permissionRepository, systemStatusReader);

  const activationReconciler = new ActivationReconciler({
    systems: repository,
    permissions: permissionRepository,
    permissionService,
    lifecycle,
    logger: logger.child({ component: "activation-reconciler" }),
  });

  // ── Part F: real swap executor ─────────────────────────────────────────────
  const allowanceEnsurer = new RouterAllowanceEnsurer({
    rpcUrl: env.XLAYER_RPC_URL,
    chainId: env.CHAIN_ID,
    logger,
    send: (p) => sessionSender.send(p),
  });

  const baseSwapExecutor = new AmmSwapExecutor({
    chainReader,
    sessionSender,
    // NOT a mock — this is `@oplier/amm-execution`'s only implementation of `RunStartBalanceStore`,
    // and it is what that package ships for production use. It is in-memory, so a restart mid-run
    // re-snapshots SYSTEM_START_BALANCE_PERCENT against the current balance rather than the run's
    // true starting balance. That package flags it; DEPLOYMENT_RUNBOOK.md §4.6 records the
    // operational consequence. Making it restart-durable needs a schema addition (nothing in
    // `system_runs` holds it), which is a Part A/B change rather than something to add here unasked.
    runStartBalanceStore: new InMemoryRunStartBalanceStore(),
    calldataEncoder: viemCalldataEncoder,
    /**
     * Approvals are OWNER-authorised, never session-key-authorised — see `router-allowance.ts` for why
     * widening the session key's scope to `approve` would be a privilege escalation. The bound is the
     * account's current balance of the source token: enough that one approval covers many swaps, but
     * capped at what the account actually holds rather than an unlimited allowance.
     */
    ensureAllowance: async ({ assetId, amountIn, permissionRef, systemId }) => {
      const ctx = await contextResolver.resolve(permissionRef);
      if (!ctx) throw new Error(`ensureAllowance: no permission context for ref "${permissionRef}"`);
      const token = getTokenConfig(assetId);
      if (!token) throw new Error(`ensureAllowance: no token config for "${assetId}"`);
      const balance = await chainReader.getBalance(token.tokenAddress, ctx.accountAddress);
      await allowanceEnsurer.ensure({
        assetId,
        accountAddress: ctx.accountAddress,
        requiredAmount: amountIn,
        // Never approve less than the swap needs, even if the balance read lags behind.
        approvalAmount: balance > amountIn ? balance : amountIn,
        systemId,
      });
    },
  });
  // Wraps the executor to fill in the reconciled amountIn/amountOut the engine now needs (doc 05
  // §16). See that file for why this is a wrapper rather than a change inside amm-execution.
  const swapExecutor = new ReconcilingSwapExecutor({
    inner: baseSwapExecutor,
    chainReader,
    sessionSender,
    logger,
  });

  // ── The engine, wired to all four real implementations ─────────────────────
  const engine = new UpmEngine({
    repository,
    priceProvider: priceAdapter,
    newsProvider,
    permissionService: toEngineAdapter(permissionService, permissionRepository),
    swapExecutor,
    receiptPollConfig: {
      pollIntervalMs: env.RECEIPT_POLL_INTERVAL_MS,
      maxWaitMs: env.RECEIPT_MAX_WAIT_MS,
    },
  });

  const loopConfig: EngineLoopConfig = {
    ...DEFAULT_ENGINE_LOOP_CONFIG,
    priceDrivenIntervalMs: env.PRICE_CYCLE_MS,
    newsIntervalMs: env.NEWS_CYCLE_MS,
    timeIntervalMs: env.TIME_CYCLE_MS,
  };
  const loop = new EngineLoop(engine, loopConfig, (err, cycle) => {
    // Every cycle error is logged and swallowed here on purpose: an unhandled rejection in one
    // cycle must never kill the process, because that would stop monitoring for every System.
    // systemd would restart us, but a crash-loop on a persistent error (e.g. one unavailable price
    // feed) would mean no evaluation at all rather than degraded evaluation.
    logger.error("cycle_error", { cycle, err });
  });

  return {
    db,
    engine,
    loop,
    logger,
    repository,
    priceAdapter,
    streamClient,
    lifecycle,
    activationReconciler,
    streamedAssets: env.PYTH_STREAM_ASSETS,
    /**
     * Resolves the owner's smart account address and caches it for owner-authority calls
     * (`uninstallValidation`). Must run before any revocation, which is why `main.ts` awaits it at
     * startup rather than letting the first revoke discover a null context.
     */
    async initOwnerSmartAccount() {
      // `requestAccount()` takes no signer argument — the signer is already bound to the client —
      // and returns a `SmartContractAccount` whose address is `.address`, not `.accountAddress`.
      const account = await smartWalletClient.requestAccount();
      ownerSmartAccount = account.address as `0x${string}`;
      logger.info("owner_smart_account_resolved", {
        owner: ownerAccount.address,
        smartAccount: ownerSmartAccount,
      });
      return ownerSmartAccount;
    },
    async shutdown() {
      loop.stop();
      priceAdapter.stopStreaming();
      streamClient.close();
      // Release the connection pool too. Process exit would eventually drop these, but a graceful
      // restart that leaves them open briefly doubles this worker's connection footprint against
      // Supabase's pooler — which is precisely how connection exhaustion starts.
      await closeDb(db);
    },
  };
}
