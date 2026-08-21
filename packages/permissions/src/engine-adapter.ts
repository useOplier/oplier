import type {
  CreatePermissionParams,
  EnginePermissionRef,
  EnginePermissionScope,
  EnginePermissionService,
  PermissionService,
} from "./types";
import type { NexusPermissionRepository } from "./repository/types";
import {
  resolveAmmRouterAddress,
  AMM_ROUTER_FUNCTION_SELECTORS,
} from "./chain";

/**
 * Bridges this package's own vendor-facing `PermissionService` (implemented literally per the
 * Part E brief in `alchemy-permission-service.ts`) to `EnginePermissionService` — copied
 * verbatim from Part C's real `types.ts` (see types.ts "RECONCILED AGAINST PART C'S REAL
 * types.ts" for the full diff against this package's earlier guess). This is the object
 * Part I actually wires into `@oplier/engine`'s `UpmEngineDeps.permissionService`.
 *
 * Two things this adapter does that `AlchemyPermissionService` alone can't, because the
 * engine's real `PermissionScope` doesn't carry the information needed:
 *
 *   1. Picks `scopedContract`/`scopedFunction` itself — Part K's AMM Router (Uniswap V2,
 *      address confirmed — see chain.ts) + its swap function selector — since the engine
 *      never supplies them.
 *   2. Persists a `nexus_permissions` row via `NexusPermissionRepository` on every
 *      `createPermission` call, specifically so it has a real DB `id` to return as
 *      `EnginePermissionRef.id` — the engine's real interface expects that shape back, not
 *      this package's own opaque `permissionRef` string alone.
 *
 * `scope.assets` (the System's involved asset ids, beyond the single `maxAllocationAsset` the
 * spend limit is denominated in) is recorded in the persisted row's `scope` JSONB for audit
 * purposes but is NOT currently used to widen the contract/function allowlist (e.g. for
 * per-token `approve()` calls a real swap flow likely needs before the router can pull
 * funds) — flagged as an open follow-up in types.ts, not silently dropped. Extending this
 * requires either changing `CreatePermissionParams`' single-contract/single-function shape
 * (which the brief asked to implement literally) or adding a second, additive call — pick one
 * with the manager thread before Part I depends on approve-scoping working.
 *
 * `scope.expiresAt` doesn't exist on the engine's real `PermissionScope` at all (see types.ts)
 * — permissions created through this adapter get no explicit `validUntil` today. Flagged, not
 * silently defaulted to something invented.
 */
export function toEngineAdapter(
  service: PermissionService,
  repository: NexusPermissionRepository,
): EnginePermissionService {
  return {
    async createPermission(scope: EnginePermissionScope): Promise<EnginePermissionRef> {
      const params: CreatePermissionParams = {
        systemId: scope.systemId,
        userWallet: scope.walletAddress,
        scopedContract: resolveAmmRouterAddress(),
        // Passed as an ARRAY, not `.join(",")` as before: Solidity signatures contain commas, so
        // the old comma-joined convention produced un-hashable fragments (see
        // `normalizeScopedFunctions` in scope-mapping.ts).
        scopedFunction: AMM_ROUTER_FUNCTION_SELECTORS,
        maxAllocation: scope.maxAllocation,
        spendLimitAssetId: scope.maxAllocationAsset,
        // RESOLVED (Part I): the engine's `PermissionScope` now carries `expiresAt`, so sessions
        // finally get a real on-chain time bound instead of none at all. `null` means the System
        // has no expiration, in which case scope-mapping.ts applies
        // DEFAULT_PERMISSION_LIFETIME_SECONDS (1 year) — a UPM must run for its real intended
        // lifetime, so this must not default to something short.
        expiresAt: scope.expiresAt ? new Date(scope.expiresAt) : undefined,
      };

      const { permissionRef, sessionData } = await service.createPermission(params);

      const row = await repository.insert({
        systemId: scope.systemId,
        sessionReference: permissionRef,
        scope: {
          walletAddress: scope.walletAddress,
          maxAllocation: scope.maxAllocation,
          maxAllocationAsset: scope.maxAllocationAsset,
          assets: scope.assets, // recorded for audit only — see header comment
          scopedContract: params.scopedContract,
          scopedFunction: params.scopedFunction,
          sessionData,
        },
      });

      return { id: row.id, sessionReference: row.sessionReference };
    },

    async revokePermission(permissionRef: EnginePermissionRef): Promise<void> {
      if (permissionRef.sessionReference) {
        await service.revokePermission(permissionRef.sessionReference);
      }
      // Mark the DB row revoked even if sessionReference was already null (e.g. a row that
      // never got a live vendor session) — same idempotency stance
      // alchemy-permission-service.ts takes on its own revokePermission.
      await repository.markRevoked(permissionRef.id, new Date());
    },
  };
}
