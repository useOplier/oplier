import type {
  CheckPermissionResult,
  CreatePermissionParams,
  CreatePermissionResult,
  PermissionService,
  SystemPermissionScope,
} from "./types";
import {
  mapSystemScopeToPermissionSet,
  type ScopeMappingDeps,
  type SessionPermission,
} from "./scope-mapping";
import { requireGasManagerPolicyId, xLayerTestnet } from "./chain";

/**
 * REWRITTEN (Part I) against the REAL installed SDK. ⚠ STILL UNVERIFIED AGAINST A LIVE CHAIN —
 * FINDINGS.md's standard applies unchanged: nothing here has produced a real signed transaction
 * on X Layer testnet, and it must before it is trusted.
 *
 * ── What changed and why ──
 *
 * The previous version called four methods on an injected client: `createModularAccountV2`,
 * `grantSessionKey`, `revokeSessionKey`, `getSessionKeyRemainingAllowance`. With
 * `@account-kit/wallet-client@4.88.5` actually installed, **three of those four do not exist.**
 * Only `createModularAccountV2` appears at all (and only on an internal path). The real client
 * surface is: `requestAccount`, `grantPermissions`, `prepareCalls`, `signPreparedCalls`,
 * `sendPreparedCalls`, `getCallsStatus`, `waitForCallsStatus`, plus signing helpers.
 *
 * So creation is now `grantPermissions({account, expirySec, key, permissions})`, which returns
 * `{context: Hex}` — the value that must later be passed as `capabilities.permissions` on every
 * call the session key makes. That context IS this package's `permissionRef` payload.
 *
 * ── Revocation: the real finding ──
 *
 * There is **no revoke method anywhere** in `@account-kit/wallet-client` or
 * `@alchemy/wallet-api-types` — no `wallet_revokeSession`, no `deleteSession`, nothing. The
 * hosted session API is **expiry-only by design**, exactly as suspected. `expirySec` is its sole
 * built-in bound.
 *
 * That is not good enough for doc 02, which requires deletion and every modification to *revoke*
 * the old permission immediately. Real revocation therefore needs the lower-level on-chain path:
 * ERC-6900 `uninstallValidation(bytes24 validationFunction, bytes uninstallData, bytes[]
 * hookUninstallData)`, which IS present on Modular Account V2's ABI (confirmed in
 * `@account-kit/smart-contracts`' `modularAccountAbi`). `OnChainSessionRevoker` below is that
 * path, and `revokePermission` calls it when one is wired in.
 *
 * ⚠ **The unresolved half, stated precisely rather than papered over:** targeting
 * `uninstallValidation` requires the session's `ModuleEntity` — a packed `(moduleAddress,
 * entityId)` pair. The hosted `wallet_createSession` response does **not** return an `entityId`
 * (verified: the string `entityId` appears nowhere in `@alchemy/wallet-api-types`' RPC types), and
 * the API chooses it internally. So a session created through the hosted path cannot currently be
 * aimed at with confidence. Two ways to close this, both requiring the live run:
 *   (a) read the account's installed validations on-chain after `grantPermissions` and match the
 *       session key address to recover its entityId; or
 *   (b) move creation to the lower-level `PermissionBuilder` install path
 *       (`@account-kit/smart-contracts`' ma-v2), where WE choose `entityId` — `deriveEntityId`
 *       below already computes a deterministic one from the systemId for exactly this purpose.
 * Creation stays on the hosted path for now per instruction; (b) is the migration if the live run
 * shows (a) is impractical.
 *
 * **This is why the software-layer gate is not optional.** `SystemPermissionLifecycle.checkBeforeExecution`
 * consults the System's live DB status before any execution, and `@oplier/engine`'s step executor
 * independently refuses to submit without an active `nexus_permissions` row. Those two together
 * mean a deleted or paused System cannot execute even while its on-chain session key is still
 * technically valid. That is defense-in-depth, NOT a substitute for on-chain revocation — a
 * session key that outlives its System is still a real liability if the worker itself is
 * compromised, which is precisely why (a)/(b) above must be resolved before mainnet.
 */

// ---------------------------------------------------------------------------
// Transport seams — kept structural (not imported from the SDK) so this package still
// typechecks and unit-tests without a live client, same discipline as the rest of the repo.
// The shapes below are copied from the installed SDK's own types, not from prose.
// ---------------------------------------------------------------------------

export interface GrantPermissionsRequest {
  account: `0x${string}`;
  expirySec: number;
  key: { publicKey: `0x${string}`; type: "secp256k1" | "ecdsa" | "contract" };
  permissions: SessionPermission[];
}

/**
 * The subset of `@account-kit/wallet-client`'s SmartWalletClient this package needs.
 * `apps/worker` supplies the real client.
 *
 * `requestAccount` takes NO signer argument — the signer is bound to the client at construction —
 * and returns a `SmartContractAccount` whose address field is `.address`. (An earlier draft here
 * assumed `{ signerAddress }` in and `{ accountAddress }` out; both were wrong, caught by compiling
 * against the installed SDK.)
 */
export interface SessionGrantingClient {
  requestAccount(): Promise<{ address: `0x${string}` }>;
  grantPermissions(params: GrantPermissionsRequest): Promise<{ context: `0x${string}` }>;
}

/**
 * The lower-level on-chain revocation path (ERC-6900 `uninstallValidation`). Implemented in
 * `apps/worker` against viem + the MA v2 ABI; absent here because this package has no RPC access.
 * Optional on purpose: when it isn't wired, `revokePermission` degrades to marking the permission
 * revoked in our own records and says so loudly rather than pretending the key is dead on-chain.
 */
export interface OnChainSessionRevoker {
  uninstallSessionValidation(params: {
    accountAddress: `0x${string}`;
    /** Session key address whose validation entity should be uninstalled. */
    sessionKeyAddress: `0x${string}`;
    /** Deterministic entity id — see `deriveEntityId`. */
    entityId: number;
  }): Promise<{ txHash: `0x${string}` }>;
}

/** Locally-generated session key for a System. `apps/worker` derives these deterministically. */
export interface SessionKeyRef {
  address: `0x${string}`;
  publicKey: `0x${string}`;
}

export interface SessionKeyProvider {
  /** Must be deterministic per systemId — the worker has to reproduce this key after a restart. */
  getSessionKeyForSystem(systemId: string): Promise<SessionKeyRef>;
}

/**
 * Deterministic `entityId` for a System's session validation, for the lower-level install/uninstall
 * path. ERC-6900 entity ids are `uint32`, and Alchemy's `PermissionBuilder` reserves the top half
 * of the range for hook entities (`entityId + HALF_UINT32`), so this stays within the bottom half.
 * Derived from the systemId so it survives a worker restart with no extra persisted state.
 */
export function deriveEntityId(systemId: string): number {
  const HALF_UINT32 = 0x80000000;
  let hash = 2166136261;
  for (let i = 0; i < systemId.length; i++) {
    hash ^= systemId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // >>> 0 to unsigned, then constrain below HALF_UINT32; +1 so 0 (PermissionBuilder's own
  // default/root entity) is never collided with.
  return ((hash >>> 0) % (HALF_UINT32 - 1)) + 1;
}

export interface AlchemyPermissionServiceDeps extends ScopeMappingDeps {
  client: SessionGrantingClient;
  sessionKeys: SessionKeyProvider;
  /** The user's own signer address, which owns the smart account. */
  ownerAddressFor: (userWallet: string) => `0x${string}`;
  /** Optional — see `OnChainSessionRevoker`. Without it, revocation is records-only. */
  onChainRevoker?: OnChainSessionRevoker;
  chainId?: number;
  gasManagerPolicyId?: string;
  /** Injected for deterministic tests. */
  now?: () => Date;
  /** Where revoked/created session metadata is recalled from across restarts. Supplied by the
   *  worker as a thin wrapper over `nexus_permissions.scope`; in-memory when absent. */
  sessionStore?: SessionMetadataStore;
}

/**
 * Metadata this service needs to recall for a permissionRef after a process restart — the whole
 * reason the previous version's in-memory `sessionsByRef` map was a durability bug (flagged in
 * that file's own comment: "A real deployment persists this via the repository layer"). Revocation
 * and validity checks are exactly the operations most likely to happen long after creation, i.e.
 * after a restart.
 */
export interface SessionMetadata {
  systemId: string;
  accountAddress: `0x${string}`;
  sessionKeyAddress: `0x${string}`;
  context: `0x${string}`;
  expirySec: number;
  entityId: number;
}

export interface SessionMetadataStore {
  get(permissionRef: string): Promise<SessionMetadata | null>;
  put(permissionRef: string, meta: SessionMetadata): Promise<void>;
  delete(permissionRef: string): Promise<void>;
}

/** Default store — process-local. Fine for tests; the worker passes a DB-backed one. */
export class InMemorySessionMetadataStore implements SessionMetadataStore {
  private readonly map = new Map<string, SessionMetadata>();
  async get(ref: string) {
    return this.map.get(ref) ?? null;
  }
  async put(ref: string, meta: SessionMetadata) {
    this.map.set(ref, meta);
  }
  async delete(ref: string) {
    this.map.delete(ref);
  }
}

export class AlchemyPermissionService implements PermissionService {
  private readonly client: SessionGrantingClient;
  private readonly deps: AlchemyPermissionServiceDeps;
  private readonly chainId: number;
  private readonly gasManagerPolicyId: string;
  private readonly store: SessionMetadataStore;
  private readonly now: () => Date;

  constructor(deps: AlchemyPermissionServiceDeps) {
    this.client = deps.client;
    this.deps = deps;
    this.chainId = deps.chainId ?? xLayerTestnet.id;
    // Still required at construction: the dashboard-created sponsorship policy is what makes
    // gasless session-key execution work at all, so a missing one should fail loudly at startup
    // rather than at the first swap.
    this.gasManagerPolicyId = deps.gasManagerPolicyId ?? requireGasManagerPolicyId();
    this.store = deps.sessionStore ?? new InMemorySessionMetadataStore();
    this.now = deps.now ?? (() => new Date());
  }

  /** The Gas Manager policy id callers pass as `capabilities.paymasterService.policyId`. */
  get paymasterPolicyId(): string {
    return this.gasManagerPolicyId;
  }

  async createPermission(params: CreatePermissionParams): Promise<CreatePermissionResult> {
    const scope: SystemPermissionScope = {
      systemId: params.systemId,
      userWallet: params.userWallet,
      scopedContract: params.scopedContract,
      scopedFunction: params.scopedFunction,
      maxAllocation: params.maxAllocation,
      expiresAt: params.expiresAt,
      chainId: this.chainId,
    };

    const permissionSet = await mapSystemScopeToPermissionSet(
      scope,
      this.deps,
      params.spendLimitAssetId,
      this.now(),
    );

    // One smart account per user wallet, resolved (not created per System) — `requestAccount` is
    // idempotent for a given signer, which is what the previous `createModularAccountV2({owner})`
    // call was reaching for. The signer is bound to the client, so `ownerAddressFor` is used for
    // bookkeeping/logging rather than being passed in.
    void this.deps.ownerAddressFor(params.userWallet);
    const { address: accountAddress } = await this.client.requestAccount();

    const sessionKey = await this.deps.sessionKeys.getSessionKeyForSystem(params.systemId);

    const { context } = await this.client.grantPermissions({
      account: accountAddress,
      expirySec: permissionSet.expirySec,
      key: { publicKey: sessionKey.publicKey, type: "secp256k1" },
      permissions: permissionSet.permissions,
    });

    // permissionRef stays this package's own opaque id — callers never learn they're talking to
    // Alchemy (brief: "Part C's engine should never need to know it's talking to Alchemy").
    const permissionRef = `perm_${params.systemId}_${sessionKey.address.slice(2, 10)}`;
    await this.store.put(permissionRef, {
      systemId: params.systemId,
      accountAddress,
      sessionKeyAddress: sessionKey.address,
      context,
      expirySec: permissionSet.expirySec,
      entityId: deriveEntityId(params.systemId),
    });

    // `sessionData` carries what the execution path needs to actually USE this permission: the
    // context goes on every `prepareCalls`/`sendPreparedCalls` as `capabilities.permissions`.
    return {
      permissionRef,
      sessionData: {
        context,
        accountAddress,
        sessionKeyAddress: sessionKey.address,
        expirySec: permissionSet.expirySec,
        paymasterPolicyId: this.gasManagerPolicyId,
      },
    };
  }

  /**
   * Real on-chain revocation via `uninstallValidation` when a revoker is wired; otherwise
   * records-only, and it says so in the thrown/returned path rather than silently succeeding.
   *
   * Idempotent for an unknown ref — doc 02 describes no "revoke twice" failure mode, and throwing
   * here would break a `modify()` racing a `delete()`.
   */
  async revokePermission(permissionRef: string): Promise<void> {
    const meta = await this.store.get(permissionRef);
    if (!meta) return;

    if (this.deps.onChainRevoker) {
      await this.deps.onChainRevoker.uninstallSessionValidation({
        accountAddress: meta.accountAddress,
        sessionKeyAddress: meta.sessionKeyAddress,
        entityId: meta.entityId,
      });
    } else {
      // Deliberately loud: callers that need real revocation must know they didn't get it. This
      // is not thrown, because the DB-level revocation (the caller's next step) is still the
      // effective control per this file's header — but it must not pass silently either.
      // eslint-disable-next-line no-console
      console.warn(
        `[permissions] revokePermission(${permissionRef}): no OnChainSessionRevoker wired — the ` +
          `session key remains valid on-chain until expirySec (${meta.expirySec}). Execution is ` +
          `still blocked by the DB-status gate (see checkBeforeExecution), but this is NOT ` +
          `on-chain revocation. See alchemy-permission-service.ts header.`,
      );
    }

    await this.store.delete(permissionRef);
  }

  /**
   * Validity check. The hosted API exposes no "remaining allowance" query (the previous version's
   * `getSessionKeyRemainingAllowance` does not exist), so this reports what can actually be known
   * without an RPC round trip: whether the session is known to us and whether it has expired.
   *
   * `remainingAllowance` is therefore intentionally omitted rather than invented —
   * `checkBeforeExecution`'s allowance comparison already treats an absent value as "unknown, do
   * not block on it," and the authoritative allowance enforcement is the on-chain
   * `erc20-token-transfer` limit itself, which reverts an over-limit swap regardless of what we
   * predicted (doc 04 §16: Nexus/the session layer is the enforcement authority, not the backend).
   */
  async checkPermissionValid(permissionRef: string): Promise<CheckPermissionResult> {
    const meta = await this.store.get(permissionRef);
    if (!meta) {
      return { valid: false, reason: "unknown_or_revoked_permission_ref" };
    }
    const nowSec = Math.floor(this.now().getTime() / 1000);
    if (meta.expirySec <= nowSec) {
      return { valid: false, reason: "expired" };
    }
    return { valid: true };
  }
}
