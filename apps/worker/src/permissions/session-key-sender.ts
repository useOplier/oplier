import type {
  ChainTransactionReceipt,
  SessionKeyTransactionSender,
  SubmittedTx,
} from "@oplier/amm-execution";
import type { Logger } from "../lib/logger.js";
import type { DerivedSessionKeyProvider } from "./session-keys.js";

/**
 * REAL `SessionKeyTransactionSender` — the Part E ↔ Part F seam that no package owned.
 *
 * `@oplier/amm-execution` declares this interface and its README calls it "the Part E seam," but
 * `@oplier/permissions` never implemented it: that package grants and revokes sessions, it never
 * relays a transaction. The only implementation in the repo was `MockSessionKeyTransactionSender`
 * in amm-execution's own `testing/` directory. So nothing could actually submit a swap. This is
 * that missing piece, built here because Part I owns connecting infrastructure.
 *
 * The real flow, using the installed SDK's actual actions (verified — the previously-assumed
 * `grantSessionKey`/`revokeSessionKey` names do not exist):
 *
 *   prepareCalls({ calls, from: smartAccount, capabilities: { paymasterService, permissions } })
 *        -> signPreparedCalls(sessionKeySigner, prepared)
 *        -> sendPreparedCalls({ ...signed, capabilities: { permissions } })   => { id }
 *        -> getCallsStatus(id)                                               => status + receipts
 *
 * Two things about that flow are worth stating because they shape this class:
 *
 *  1. **`sendPreparedCalls` returns a bundle `id`, not a transaction hash.** EIP-5792 batch ids are
 *     not tx hashes. `amm-execution` keys everything off `txHash`, so this class returns the bundle
 *     id as the handle and resolves the REAL `transactionHash` out of `getCallsStatus`'s receipts
 *     once the bundle lands. `getTransactionReceipt` accepts either the bundle id or the eventual
 *     tx hash, so a receipt lookup still works after a restart when only the persisted
 *     `executions.tx_hash` is available.
 *  2. **Gas is sponsored** via the dashboard-created Gas Manager policy, passed as
 *     `capabilities.paymasterService.policyId`. Without it the session key would need its own gas,
 *     which it has none of.
 *
 * ⚠ NOT YET RUN AGAINST A LIVE CHAIN. Types are checked against the installed SDK, but no bundle
 * has been submitted to X Layer testnet. FINDINGS.md's standard applies.
 */

/** EIP-5792 `wallet_getCallsStatus` codes, per the installed SDK's own literal union. */
/**
 * Default `callGasLimit` multiplier. 2x rather than a tight 1.2x because the overhead that the
 * estimate misses (account dispatch + session-key spend-limit storage writes) is roughly fixed, so it
 * is proportionally largest on the cheapest calls. Unused gas is refunded, so over-provisioning the
 * limit costs nothing beyond a briefly higher required prefund.
 */
const DEFAULT_CALL_GAS_MULTIPLIER = 2;

/**
 * Default `verificationGasLimit` multiplier.
 *
 * WHY THIS EXISTS SEPARATELY: doubling `callGasLimit` alone did NOT fix the rejection. Measured on
 * X Layer testnet, `prepareCalls` returned `callGasLimit` 198041; overriding it to 396082 produced a
 * byte-identical `Simulation ran out of gas for entity: account:"0x9dAF…Cce4"` (code -32502). The
 * call phase is therefore not the binding constraint — the account entity's VALIDATION phase is, and
 * that is bounded by `verificationGasLimit`.
 *
 * WHY 1.15, AND WHY A BIG MULTIPLIER IS ACTIVELY WRONG HERE. Rundler enforces a *minimum* ratio of
 * used-to-provided verification gas (0.4), so over-provisioning is rejected just as hard as
 * under-provisioning. The usable band is therefore `used <= limit <= used / 0.4`, i.e. at most 2.5x
 * actual usage — a multiplier is only safe while it stays inside that.
 *
 * The trap: the bundler's base estimate is NOT stable across the session key's lifetime. Measured on
 * X Layer testnet for the identical call:
 *
 *   COLD (session key's first ever use)  base verificationGasLimit = 687,603, actual used ~553,000
 *   WARM (every use after that)          base verificationGasLimit = 122,798, actual used  ~83,400
 *
 * The first use pays to install the session key's validation hook; afterwards it does not. Calibrating
 * on the cold number and applying it warm is what produced
 * `Verification gas limit efficiency too low. Required: 0.4, Actual: 0.39952193219868076` — 1.7 x
 * 122,798 = 208,757 against ~83,400 used, missing the floor by 0.0005.
 *
 * 1.15 keeps a margin over the estimate without approaching the ceiling: warm that is ~141,000, an
 * efficiency of ~0.59, and comfortably above the ~83,400 actually consumed.
 *
 * If this ever needs re-tuning, re-run `e2e-probe-gas.tmp.ts` — but read the base estimate out of
 * `prepared_gas_params` FIRST and check whether you are looking at a cold or warm number, because the
 * two differ by more than 5x and a bracket measured on one does not transfer to the other.
 */
const DEFAULT_VERIFICATION_GAS_MULTIPLIER = 1.15;

const CALLS_STATUS = {
  /** 100-1xx: received/queued/in-flight — not yet resolved on-chain. */
  PENDING_MAX: 199,
  /** 200: included on-chain without reverts. */
  CONFIRMED: 200,
} as const;

/** Minimal shape of the SDK's SmartWalletClient that this sender needs. */
export interface PreparedCallsClient {
  prepareCalls(params: {
    calls: Array<{ to: `0x${string}`; data?: `0x${string}`; value?: `0x${string}` }>;
    from: `0x${string}`;
    capabilities?: Record<string, unknown>;
  }): Promise<unknown>;
  sendPreparedCalls(params: unknown): Promise<{ id: `0x${string}` }>;
  getCallsStatus(id: `0x${string}`): Promise<{
    id: `0x${string}`;
    status: number;
    receipts?: Array<{
      logs: Array<{ address: `0x${string}`; data: `0x${string}`; topics: `0x${string}`[] }>;
      status: `0x${string}`;
      blockNumber: number;
      transactionHash: `0x${string}`;
    }>;
  }>;
}

/** `signPreparedCalls(signer, prepared)` as exported by @account-kit/wallet-client. */
export type SignPreparedCallsFn = (signer: unknown, prepared: unknown) => Promise<unknown>;

/**
 * Resolves the metadata needed to submit under a given permissionRef. Backed by
 * `nexus_permissions.scope` (where `createPermission` stored `sessionData`), so this survives a
 * worker restart.
 */
export interface PermissionContextResolver {
  resolve(permissionRef: string): Promise<{
    context: `0x${string}`;
    accountAddress: `0x${string}`;
    systemId: string;
    paymasterPolicyId: string;
  } | null>;
}

export interface SessionKeySenderDeps {
  client: PreparedCallsClient;
  signPreparedCalls: SignPreparedCallsFn;
  sessionKeys: DerivedSessionKeyProvider;
  permissionContexts: PermissionContextResolver;
  logger: Logger;
  /** When true, never submits — logs the fully-prepared call and returns a synthetic handle. */
  dryRun?: boolean;
  /**
   * Whether to request Gas Manager sponsorship. Defaults to false: sponsorship is non-functional on
   * X Layer testnet (see `config/env.ts`'s `GAS_SPONSORSHIP_ENABLED` for the verified evidence), and
   * requesting it there yields a zero-gas userop the bundler rejects outright. When false the smart
   * account pays its own gas and must hold a native balance.
   */
  sponsorGas?: boolean;
  /**
   * Multiplier applied to the bundler's `callGasLimit` estimate via the Wallet API's official
   * `capabilities.gasParamsOverride`.
   *
   * WHY THIS IS NEEDED: Alchemy's estimate covers the inner call but leaves too little headroom for
   * what the smart account does AROUND it. Measured on X Layer testnet: the raw
   * `swapExactTokensForTokens` costs 175,497 gas, and `prepareCalls` returned a `callGasLimit` of
   * 198,041 — about 22k of slack. The account's `execute` dispatch plus the session key's
   * spend-limit enforcement (a storage write, ~20k on its own) exceeds that, and the bundler rejects
   * the userop with `Simulation ran out of gas for entity: account`. Overriding with a multiplier is
   * the supported fix; editing the prepared op after the fact would invalidate its signature.
   *
   * Only `callGasLimit` is scaled — verification and preVerification estimates were accurate. This
   * raises the gas LIMIT, not the price, so unused gas is refunded and the real cost is unchanged.
   */
  callGasLimitMultiplier?: number;
  /**
   * Multiplier applied to the bundler's `verificationGasLimit` estimate. See
   * `DEFAULT_VERIFICATION_GAS_MULTIPLIER` for why this is a separate knob from the call-gas one.
   */
  verificationGasLimitMultiplier?: number;
}

export class AlchemySessionKeySender implements SessionKeyTransactionSender {
  private readonly logger: Logger;
  /**
   * bundle id -> resolved tx hash, populated once a bundle lands. Purely a lookup shortcut;
   * `getTransactionReceipt` works without it (it accepts a bundle id directly), so losing this on
   * restart costs nothing.
   */
  private readonly txHashByBundleId = new Map<string, `0x${string}`>();

  constructor(private readonly deps: SessionKeySenderDeps) {
    this.logger = deps.logger.child({ component: "session-sender" });
  }

  async send(params: { to: string; data: string; permissionRef: string }): Promise<SubmittedTx> {
    const ctx = await this.deps.permissionContexts.resolve(params.permissionRef);
    if (!ctx) {
      // Surfaced as a thrown error so the engine's step executor classifies it rather than the
      // worker silently submitting nothing and reporting success.
      throw new Error(
        `No permission context for permissionRef "${params.permissionRef}" — cannot authorize this swap. ` +
          `The nexus_permissions row is missing its sessionData context (see permission-context-resolver.ts).`,
      );
    }

    const call = { to: params.to as `0x${string}`, data: params.data as `0x${string}` };

    if (this.deps.dryRun) {
      this.logger.warn("dry_run_submit_skipped", {
        to: call.to,
        systemId: ctx.systemId,
        dataBytes: (params.data.length - 2) / 2,
      });
      // A recognisably synthetic handle — never a plausible-looking fake hash, so it can't be
      // mistaken for a real transaction in the DB or in a log.
      return { txHash: `0xdryrun${Date.now().toString(16)}` };
    }

    // Must be the SmartAccountSigner wrapper, NOT the bare viem account — see
    // `session-keys.ts#getSignerForSystem` for why passing the account throws inside viem.
    const signer = this.deps.sessionKeys.getSignerForSystem(ctx.systemId);

    // `paymasterService` is included ONLY when sponsorship is enabled. Passing it on a chain where
    // the policy does not actually sponsor produces preVerificationGas=0 / maxFeePerGas=0 and the
    // bundler rejects the userop, so an unconditional capability here would fail every swap.
    const prepared = await this.deps.client.prepareCalls({
      calls: [call],
      from: ctx.accountAddress,
      capabilities: {
        ...(this.deps.sponsorGas ? { paymasterService: { policyId: ctx.paymasterPolicyId } } : {}),
        permissions: { context: ctx.context },
        gasParamsOverride: {
          callGasLimit: { multiplier: this.deps.callGasLimitMultiplier ?? DEFAULT_CALL_GAS_MULTIPLIER },
          verificationGasLimit: {
            multiplier:
              this.deps.verificationGasLimitMultiplier ?? DEFAULT_VERIFICATION_GAS_MULTIPLIER,
          },
        },
      },
    });

    // Logged because the bundler's rejection text names an entity but not which gas limit bound it,
    // so the only way to tell an honoured override from an ignored one is to see the prepared values.
    const preparedGas = (prepared as { data?: Record<string, unknown> }).data ?? {};
    this.logger.info("prepared_gas_params", {
      systemId: ctx.systemId,
      callGasLimit: preparedGas.callGasLimit,
      verificationGasLimit: preparedGas.verificationGasLimit,
      preVerificationGas: preparedGas.preVerificationGas,
      maxFeePerGas: preparedGas.maxFeePerGas,
    });

    const signed = await this.deps.signPreparedCalls(signer, prepared);

    const { id } = await this.deps.client.sendPreparedCalls({
      ...(signed as Record<string, unknown>),
      capabilities: { permissions: { context: ctx.context } },
    });

    this.logger.info("bundle_submitted", { bundleId: id, systemId: ctx.systemId, to: call.to });

    // Returned as the handle. See the class doc: this is a bundle id, not a tx hash, and
    // `getTransactionReceipt` resolves the real hash from it.
    return { txHash: id };
  }

  async getTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null> {
    if (txHash.startsWith("0xdryrun")) {
      // Dry-run handles never landed on-chain; report perpetually pending rather than inventing a
      // success, so a dry run can't mark an execution COMPLETED.
      return null;
    }

    // `getCallsStatus` takes the bundle id. A persisted value could be either the bundle id (what
    // `send` returned) or a real tx hash if something upstream already resolved it; both are hex, so
    // try the lookup and treat a failure as "not yet available" rather than fatal.
    let status: Awaited<ReturnType<PreparedCallsClient["getCallsStatus"]>>;
    try {
      status = await this.deps.client.getCallsStatus(txHash as `0x${string}`);
    } catch (err) {
      this.logger.warn("calls_status_lookup_failed", { txHash, err });
      return null;
    }

    if (status.status <= CALLS_STATUS.PENDING_MAX) {
      return null; // still in flight — doc 05 §15's PENDING stays PENDING
    }

    const receipt = status.receipts?.[0];
    if (!receipt) {
      // Resolved to a non-pending status but produced no receipt: an off-chain failure (400/410) —
      // the bundle never made it on-chain. Reported as reverted with the code, so
      // `classify-error.ts` can decide retryability rather than this class guessing.
      return {
        status: "reverted",
        blockNumber: 0,
        revertReason: `bundle failed off-chain with status ${status.status}`,
        logs: [],
      };
    }

    this.txHashByBundleId.set(txHash, receipt.transactionHash);

    // `receipt.status` is hex: 0x1 success, 0x0 reverted. Trust the receipt over the batch code,
    // since a partially-reverted batch (600) still carries per-tx truth here.
    const succeeded = status.status === CALLS_STATUS.CONFIRMED && BigInt(receipt.status) === 1n;

    return {
      status: succeeded ? "success" : "reverted",
      blockNumber: Number(receipt.blockNumber),
      ...(succeeded ? {} : { revertReason: `batch status ${status.status}, receipt status ${receipt.status}` }),
      logs: receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })),
    };
  }

  /** The real on-chain tx hash for a bundle, once known — used for explorer links and logging. */
  resolvedTxHash(bundleId: string): `0x${string}` | undefined {
    return this.txHashByBundleId.get(bundleId);
  }
}
