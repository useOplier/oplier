import { numberToHex, toFunctionSelector } from "viem";
import type { SystemPermissionScope } from "./types";

/**
 * REWRITTEN (Part I) against the REAL `wallet_createSession` permission model.
 *
 * The previous version of this file described a `{contractAllowlist, functionSelectors,
 * erc20SpendLimit, timeBound}` shape assembled from Alchemy's prose documentation, with its own
 * header flagging it as "built from documentation, NOT copied from a working SDK call." With
 * `@account-kit/wallet-client@4.88.5` and `@alchemy/wallet-api-types@0.1.0-alpha.25` actually
 * installed, that shape turned out not to exist. The real schema
 * (`wallet-api-types/dist/esm/rpc/request.d.ts`, `wallet_createSession`) is a flat, discriminated
 * ARRAY of permission entries:
 *
 *   { type: "root",                        data?: never }
 *   { type: "native-token-transfer",       data: { allowance: bigint } }
 *   { type: "erc20-token-transfer",        data: { allowance: bigint; address: `0x${string}` } }
 *   { type: "gas-limit",                   data: { limit: bigint } }
 *   { type: "contract-access",             data: { address: `0x${string}` } }
 *   { type: "account-functions",           data: { functions: `0x${string}`[] } }
 *   { type: "functions-on-all-contracts",  data: { functions: `0x${string}`[] } }
 *   { type: "functions-on-contract",       data: { address: `0x${string}`; functions: `0x${string}`[] } }
 *
 * ...and the time bound is NOT a permission entry at all — it's a top-level `expirySec` integer
 * on the session request.
 *
 * Three consequences worth stating plainly, because they change what this layer can promise:
 *
 *  1. `functions-on-contract` is a strictly better fit than the old two-part
 *     contract-allowlist-plus-selectors idea: it scopes contract AND function in one entry, which
 *     is exactly what doc 02 asks for ("scoped by contract, function, ...").
 *  2. Function entries are 4-BYTE SELECTORS (`^0x.*$`), not human-readable signatures. The old
 *     file assumed the SDK would resolve signatures for us ("resolved to a selector at call time
 *     by the real Alchemy SDK call") — it does not. `chain.ts` still stores readable signatures
 *     because they're reviewable, and this module hashes them with viem's `toFunctionSelector`.
 *  3. Spend limits are `bigint` base units, not decimal strings. This module is therefore the one
 *     place that converts, using the token's real `decimals` from `asset_registry` — never a
 *     guessed 18.
 *
 * ⚠ STILL UNVERIFIED AGAINST A LIVE CHAIN. The shapes here now match the installed SDK's own
 * types (so they are compiler-checked rather than prose-derived), but no session has been created
 * against X Layer testnet from this code. FINDINGS.md §3's standard applies unchanged: this needs
 * a real signed transaction with a funded wallet before it is trusted.
 */

/**
 * One entry in `wallet_createSession`'s `permissions` array. Mirrors the installed SDK's union.
 *
 * AMOUNT FIELDS ARE HEX STRINGS, NOT bigint — corrected against a real API response. The installed
 * `@alchemy/wallet-api-types@0.1.0-alpha.25` declares them as
 * `TCodec<TTemplateLiteral<"^0x.*$">, bigint>`: a codec whose WIRE form is a `0x`-prefixed quantity
 * and whose decoded form is a bigint. That alpha SDK does not apply the encode step on the
 * `grantPermissions` path, so a bigint reached `JSON.stringify` and went out as the decimal string
 * `"5000000"`, which Alchemy rejected with:
 *
 *   InvalidParamsRpcError: Must be a valid hex string starting with '0x'
 *   Path: params[0].permissions[1].data.allowance
 *
 * Encoding here is therefore deliberate, not a workaround for a type mismatch. Re-check when the SDK
 * leaves alpha: if it starts applying its own codec, hex-encoding twice would break just as loudly.
 */
export type SessionPermission =
  | { type: "root" }
  | { type: "native-token-transfer"; data: { allowance: `0x${string}` } }
  | { type: "erc20-token-transfer"; data: { allowance: `0x${string}`; address: `0x${string}` } }
  | { type: "gas-limit"; data: { limit: `0x${string}` } }
  | { type: "contract-access"; data: { address: `0x${string}` } }
  | { type: "account-functions"; data: { functions: `0x${string}`[] } }
  | { type: "functions-on-all-contracts"; data: { functions: `0x${string}`[] } }
  | { type: "functions-on-contract"; data: { address: `0x${string}`; functions: `0x${string}`[] } };

/**
 * What this package hands the transport layer for one System: the permission array plus the
 * top-level `expirySec` (which is session-level config in the real API, not a permission entry).
 */
export interface SessionPermissionSet {
  permissions: SessionPermission[];
  /** Unix SECONDS (not ms) — the real API's unit. */
  expirySec: number;
  chainId: number;
}

export const DEFAULT_SPEND_LIMIT_TOKEN_ASSET_ID = "test_usdg";

/**
 * Default session lifetime when a System sets no `expiresAt` (manager-confirmed): one year.
 *
 * A UPM is explicitly expected to run autonomously for its real intended lifetime — doc 04 §13
 * makes System expiration OPTIONAL, so "no expiration" is a normal, supported configuration, not
 * an oversight. A short default (hours/days) would silently kill exactly the long-running
 * accumulation Systems doc 01 §1 uses as its headline example. This is deliberately finite rather
 * than unbounded: `expirySec` is the ONLY revocation mechanism the hosted session API actually
 * provides (see `alchemy-permission-service.ts`), so an unbounded session would be a permission
 * that can never expire on its own.
 */
export const DEFAULT_PERMISSION_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

export interface ScopeMappingDeps {
  /** Resolves an asset_id (e.g. "test_usdg") to its on-chain token address. Injected rather
   *  than imported from @oplier/db directly — same repository-seam reasoning Part C used. */
  resolveAssetTokenAddress: (assetId: string) => Promise<string>;
  /**
   * Resolves an asset_id to its ERC-20 `decimals`, so a decimal-string allowance can be
   * converted to base units correctly. REQUIRED, not optional and not defaulted to 18: USDG is
   * 6 decimals while the mock RWA tokens are 18 (`@oplier/amm-execution`'s config/assets.ts), so
   * a hardcoded 18 would inflate a USDG spend limit by 10^12 — i.e. it would render the spend
   * limit meaningless in the most dangerous possible direction.
   */
  resolveAssetDecimals: (assetId: string) => Promise<number>;
}

/**
 * Converts a decimal string to base units with BigInt arithmetic (no float rounding).
 * Truncates excess precision rather than rounding, matching ERC-20 convention and
 * `@oplier/amm-execution`'s `parseDecimalToBaseUnits`.
 */
export function toBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Cannot convert "${value}" to base units — expected a non-negative decimal string`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole + padded);
}

function assertHexAddress(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte hex address, got "${value}"`);
  }
  return value as `0x${string}`;
}

/**
 * Resolves a function signature or an already-computed selector into a 4-byte selector.
 * `chain.ts` stores readable signatures (reviewable in a diff); the wire format needs selectors.
 * Verified against viem: `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`
 * hashes to `0x38ed1739`, Uniswap V2's real published selector for that method.
 */
export function toSelector(signatureOrSelector: string): `0x${string}` {
  const trimmed = signatureOrSelector.trim();
  if (/^0x[0-9a-fA-F]{8}$/.test(trimmed)) return trimmed as `0x${string}`;
  return toFunctionSelector(trimmed);
}

/**
 * Normalizes `scopedFunction` into a list of signatures.
 *
 * BUG FIX (Part I): the previous convention was "one string, comma-separated for multiple
 * signatures," split with `.split(",")`. That is fundamentally broken for Solidity function
 * signatures, because **signatures contain commas**: splitting
 * `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` produces the fragments
 * `swapExactTokensForTokens(uint256`, `uint256`, `address[]`, `address`, `uint256)`, none of which
 * is a valid signature. The old code never surfaced this because it never actually resolved
 * selectors — it passed the raw strings to an SDK method that does not exist, so the fragments
 * were never hashed. The first real `toFunctionSelector` call failed immediately with
 * "Unable to normalize signature".
 *
 * An array is now the canonical form. A plain string is accepted and treated as exactly ONE
 * signature — never comma-split — so single-signature callers keep working unchanged.
 */
function normalizeScopedFunctions(scopedFunction: string | readonly string[]): string[] {
  const list = typeof scopedFunction === "string" ? [scopedFunction] : [...scopedFunction];
  return list.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Computes `expirySec` for a System: its own `expiresAt` when set, otherwise
 * now + `DEFAULT_PERMISSION_LIFETIME_SECONDS`.
 *
 * An `expiresAt` already in the past is rejected rather than silently clamped — creating a
 * pre-expired session key would produce a System that looks ACTIVE but can never execute, which
 * is precisely the confusing half-broken state doc 02's "invalid authorization blocks execution"
 * rule exists to surface loudly.
 */
export function resolveExpirySec(expiresAt: Date | null | undefined, now: Date = new Date()): number {
  const nowSec = Math.floor(now.getTime() / 1000);
  if (!expiresAt) return nowSec + DEFAULT_PERMISSION_LIFETIME_SECONDS;
  const expirySec = Math.floor(expiresAt.getTime() / 1000);
  if (expirySec <= nowSec) {
    throw new Error(
      `System expiresAt (${expiresAt.toISOString()}) is not in the future — refusing to create an already-expired session key.`,
    );
  }
  return expirySec;
}

/**
 * Maps a System's scope onto the real session permission model.
 *
 * Emits exactly two entries, which together are doc 02's required scoping:
 *   - `functions-on-contract`  — only the AMM Router, and only its swap entry point(s).
 *   - `erc20-token-transfer`   — spend limit on the System's `max_allocation_asset`, in base units.
 *
 * Deliberately NOT emitted, flagged rather than silently assumed unnecessary:
 *   - `gas-limit`: gas is sponsored via the Gas Manager policy, so a session-level gas cap would
 *     be a second, redundant control. Add one if sponsorship is ever removed.
 *   - `native-token-transfer`: no MVP System has a native-asset leg (`chain.ts` deliberately
 *     keeps the router selector list to the token-to-token entry point for the same reason).
 *   - `root`: never — that would defeat the entire point of scoping.
 *
 * KNOWN GAP (carried forward from the previous version, not introduced here): `scope.assets` is
 * still not used to scope the per-token `approve()` calls a real V2 swap needs before the Router
 * can pull funds. With only `functions-on-contract` on the Router, an `approve()` sent to a token
 * contract is NOT authorized by this session. Whether the approve is pre-granted out-of-band
 * (once per token, by the user's own EOA) or needs its own session entry is a real open question
 * for the live-verification run — if the swap reverts on transfer-from, this is the first thing to
 * check. Emitting a broad `functions-on-all-contracts: [approve]` would close it, but that
 * authorizes `approve` on EVERY contract, which is a materially worse security posture than
 * leaving it explicit and unresolved.
 */
export async function mapSystemScopeToPermissionSet(
  scope: SystemPermissionScope,
  deps: ScopeMappingDeps,
  spendLimitAssetId: string = DEFAULT_SPEND_LIMIT_TOKEN_ASSET_ID,
  now: Date = new Date(),
): Promise<SessionPermissionSet> {
  const [tokenAddress, decimals] = await Promise.all([
    deps.resolveAssetTokenAddress(spendLimitAssetId),
    deps.resolveAssetDecimals(spendLimitAssetId),
  ]);

  const routerAddress = assertHexAddress(scope.scopedContract, "scopedContract (AMM Router)");
  const selectors = normalizeScopedFunctions(scope.scopedFunction).map(toSelector);

  if (selectors.length === 0) {
    throw new Error(`No function selectors resolved for System ${scope.systemId} — refusing to create an unscoped session.`);
  }

  return {
    permissions: [
      { type: "functions-on-contract", data: { address: routerAddress, functions: selectors } },
      {
        type: "erc20-token-transfer",
        data: {
          // toBaseUnits gives the correct integer; the wire format needs it hex (see SessionPermission).
          allowance: numberToHex(toBaseUnits(scope.maxAllocation, decimals)),
          address: assertHexAddress(tokenAddress, `token address for ${spendLimitAssetId}`),
        },
      },
    ],
    expirySec: resolveExpirySec(scope.expiresAt, now),
    chainId: scope.chainId,
  };
}
