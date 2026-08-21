import { encodeFunctionData, concatHex, pad, toHex, type PublicClient } from "viem";
import type { OnChainSessionRevoker } from "@oplier/permissions";
import type { Logger } from "../lib/logger.js";
import type { AlchemySessionKeySender } from "./session-key-sender.js";

/**
 * On-chain session revocation via ERC-6900 `uninstallValidation` — the lower-level path, because
 * the hosted Alchemy session API has no revoke method at all.
 *
 * That absence is a verified finding, not an assumption: there is no `wallet_revokeSession`,
 * `deleteSession`, or equivalent anywhere in `@account-kit/wallet-client@4.88.5` or
 * `@alchemy/wallet-api-types@0.1.0-alpha.25`. `expirySec` is the hosted product's only bound, which
 * makes it expiry-only by design. doc 02 requires immediate revocation on delete and on every
 * modification, so that gap has to be closed at the contract level.
 *
 * Modular Account V2 exposes (confirmed in `@account-kit/smart-contracts`' `modularAccountAbi`):
 *
 *   uninstallValidation(bytes24 validationFunction, bytes uninstallData, bytes[] hookUninstallData)
 *
 * where `validationFunction` is a packed `ModuleEntity` = 20-byte module address ++ 4-byte
 * uint32 entityId.
 *
 * ⚠⚠ THE UNRESOLVED PART — read before trusting this.
 *
 * Targeting `uninstallValidation` requires the session's `entityId`. The hosted
 * `wallet_createSession` response does **not** return one (verified: the string `entityId` appears
 * nowhere in `@alchemy/wallet-api-types`' RPC types), and the hosted API assigns it internally. So
 * for a session created through `grantPermissions`, the entityId this class computes
 * (`deriveEntityId(systemId)`) is **our** deterministic value, not necessarily the one the hosted
 * API actually used. Consequences, stated plainly:
 *
 *   - If they differ, `uninstallValidation` will revert (nothing installed at that entity) or, worse,
 *     uninstall the wrong entity. This class therefore SIMULATES the call first and refuses to
 *     submit if simulation fails, so a mismatch surfaces as a clean error rather than a bad
 *     transaction.
 *   - Closing this properly needs one of: (a) enumerating the account's installed validations
 *     on-chain after `grantPermissions` and matching by session-key address, or (b) moving session
 *     creation to the lower-level `PermissionBuilder` install path where we choose the entityId. (b)
 *     is the cleaner end state and `deriveEntityId` already exists for it.
 *   - Until then, the effective revocation guarantee is the software gate:
 *     `SystemPermissionLifecycle.checkBeforeExecution` (live DB status) plus the engine's own
 *     refusal to submit without an active `nexus_permissions` row. Those stop a deleted/paused
 *     System from executing. They do NOT make the on-chain key inert.
 *
 * This is exactly the kind of chain-specific, vendor-specific behaviour FINDINGS.md §3 predicted
 * would need a live run. Do that run before mainnet.
 */

/** `uninstallValidation` fragment from MA v2's ABI. */
const UNINSTALL_VALIDATION_ABI = [
  {
    type: "function",
    name: "uninstallValidation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validationFunction", type: "bytes24" },
      { name: "uninstallData", type: "bytes" },
      { name: "hookUninstallData", type: "bytes[]" },
    ],
    outputs: [],
  },
] as const;

/**
 * Packs an ERC-6900 `ModuleEntity`: 20-byte module address followed by a 4-byte big-endian
 * entityId, giving the 24 bytes the ABI expects.
 */
export function packModuleEntity(moduleAddress: `0x${string}`, entityId: number): `0x${string}` {
  const entityHex = pad(toHex(entityId), { size: 4, dir: "left" });
  return concatHex([moduleAddress, entityHex]);
}

export interface OnChainRevokerDeps {
  publicClient: PublicClient;
  sender: AlchemySessionKeySender;
  /**
   * Module address holding the session's validation function. For a single-signer session key this
   * is the SingleSignerValidation module — resolve it via
   * `getDefaultSingleSignerValidationModuleAddress(chain)` from `@account-kit/smart-contracts` and
   * pass it in, so this class doesn't hardcode a per-chain address.
   */
  validationModuleAddress: `0x${string}`;
  logger: Logger;
  /** When set, log the intended revocation and skip submission. */
  dryRun?: boolean;
}

export class Erc6900SessionRevoker implements OnChainSessionRevoker {
  private readonly logger: Logger;

  constructor(private readonly deps: OnChainRevokerDeps) {
    this.logger = deps.logger.child({ component: "on-chain-revoker" });
  }

  async uninstallSessionValidation(params: {
    accountAddress: `0x${string}`;
    sessionKeyAddress: `0x${string}`;
    entityId: number;
  }): Promise<{ txHash: `0x${string}` }> {
    const validationFunction = packModuleEntity(this.deps.validationModuleAddress, params.entityId);

    const data = encodeFunctionData({
      abi: UNINSTALL_VALIDATION_ABI,
      functionName: "uninstallValidation",
      // Empty uninstall data: the single-signer validation module holds no extra state to clean up
      // beyond the entity itself, and no hooks were installed alongside it by this codebase.
      args: [validationFunction, "0x", []],
    });

    if (this.deps.dryRun) {
      this.logger.warn("dry_run_revoke_skipped", {
        account: params.accountAddress,
        sessionKey: params.sessionKeyAddress,
        entityId: params.entityId,
      });
      return { txHash: `0xdryrun${Date.now().toString(16)}` };
    }

    // Simulate FIRST. This is what turns the entityId uncertainty documented above into a clean,
    // loud failure instead of a submitted transaction that reverts or hits the wrong entity.
    try {
      await this.deps.publicClient.call({
        to: params.accountAddress,
        data,
      });
    } catch (err) {
      this.logger.error("revoke_simulation_failed", {
        account: params.accountAddress,
        sessionKey: params.sessionKeyAddress,
        entityId: params.entityId,
        err,
        detail:
          "uninstallValidation simulation reverted — most likely the hosted wallet_createSession " +
          "assigned a different entityId than deriveEntityId() computed. See this file's header: " +
          "resolve by enumerating installed validations on-chain, or move session creation to the " +
          "lower-level PermissionBuilder install path. Execution is still blocked in software by " +
          "checkBeforeExecution, but the on-chain key is NOT revoked.",
      });
      throw new Error(
        `On-chain session revocation could not be simulated for account ${params.accountAddress} ` +
          `(entityId ${params.entityId}) — refusing to submit. The session key remains valid on-chain; ` +
          `the DB-status gate is what is currently preventing execution.`,
      );
    }

    // Submitted through the account itself. `uninstallValidation` is an owner-authorized operation,
    // so it goes out under the owner's authority, not the session key being revoked — a session key
    // cannot be expected to authorize its own removal.
    const { txHash } = await this.deps.sender.send({
      to: params.accountAddress,
      data,
      // Intentionally the owner path: see `permission-context-resolver.ts`'s OWNER_PERMISSION_REF.
      permissionRef: OWNER_PERMISSION_REF,
    });

    this.logger.info("session_revoked_on_chain", {
      account: params.accountAddress,
      sessionKey: params.sessionKeyAddress,
      entityId: params.entityId,
      txHash,
    });

    return { txHash: txHash as `0x${string}` };
  }
}

/**
 * Sentinel permissionRef meaning "submit under the smart account owner's own authority, not a
 * scoped session key." Used for account-administration calls like `uninstallValidation`, which a
 * session key has no business being able to make.
 */
export const OWNER_PERMISSION_REF = "__owner__";
