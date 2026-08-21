import type { ChainReader, RunStartBalanceStore, SwapParams } from "../types.js";
import { SwapExecutionError } from "../types.js";
import { getTokenConfig } from "../config/assets.js";

/**
 * Parses a decimal string (e.g. "10.5") into raw base units for the given number of decimals,
 * without floating-point rounding error (BigInt arithmetic on the split integer/fractional
 * parts). Truncates any fractional precision beyond `decimals` rather than rounding — matches
 * how ERC-20 amounts are conventionally floored, not rounded, when converting from a
 * human-entered decimal.
 */
export function parseDecimalToBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new SwapExecutionError("INVALID_AMOUNT", false, `"${value}" is not a valid non-negative decimal amount`);
  }
  const [wholePart, fractionalPart = ""] = trimmed.split(".");
  const paddedFraction = (fractionalPart + "0".repeat(decimals)).slice(0, decimals);
  const raw = BigInt(wholePart + paddedFraction);
  if (raw <= 0n) {
    throw new SwapExecutionError("INVALID_AMOUNT", false, `Resolved amount must be greater than zero, got "${value}"`);
  }
  return raw;
}

function applyPercent(balance: bigint, percentStr: string): bigint {
  const percent = Number(percentStr);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new SwapExecutionError(
      "INVALID_AMOUNT",
      false,
      `Percent amount must be a number in (0, 100], got "${percentStr}"`,
    );
  }
  // Integer bps math to avoid floating-point drift on the balance itself.
  const bps = BigInt(Math.round(percent * 100)); // percent -> bps (2 decimal places of percent precision)
  const raw = (balance * bps) / 10_000n;
  if (raw <= 0n) {
    throw new SwapExecutionError(
      "INVALID_AMOUNT",
      false,
      `${percentStr}% of balance (${balance}) resolves to zero`,
    );
  }
  return raw;
}

export interface ResolveAmountDeps {
  chainReader: ChainReader;
  runStartBalanceStore: RunStartBalanceStore;
}

/**
 * Resolves `SwapParams.amountType`/`amountValue` into a raw base-unit `amountIn` for the
 * source asset. Per ENGINE_CONTRACT.md §1, this resolution is explicitly this part's
 * responsibility — the engine passes these two fields through unresolved.
 *
 * FLAG (mirrors ENGINE_CONTRACT.md's own "still genuinely open" #3-style disclosure): the
 * SYSTEM_START_BALANCE_PERCENT snapshot below is captured lazily, in-memory, keyed by
 * `runId`+`assetId` (`RunStartBalanceStore.getOrSet`) — same pattern Part C's
 * `BaselinePriceStore` uses for PRICE_PERCENT's ratchet. This does not survive a worker
 * process restart mid-run. Doc 05 §6/full_specifications.txt §6 defines *what* "balance at
 * System execution start" means but not *where* that snapshot is persisted, and no schema
 * column holds it (checked `full_schema.txt` — `system_runs` has no such field). If a
 * restart-durable snapshot is required, this needs a small persistence addition (a column on
 * `system_runs` or a side table), the same category of gap as Part C's repository seam —
 * flagging so it's a conscious call, not implementing unrequested schema changes here.
 */
export async function resolveAmountIn(params: SwapParams, deps: ResolveAmountDeps): Promise<bigint> {
  const sourceToken = getTokenConfig(params.sourceAsset);
  if (!sourceToken) {
    throw new SwapExecutionError("UNKNOWN_ASSET", false, `No token config for assetId "${params.sourceAsset}"`);
  }

  switch (params.amountType) {
    case "FIXED":
      return parseDecimalToBaseUnits(params.amountValue, sourceToken.decimals);

    case "CURRENT_BALANCE_PERCENT": {
      const balance = await deps.chainReader.getBalance(sourceToken.tokenAddress, params.walletAddress);
      return applyPercent(balance, params.amountValue);
    }

    case "SYSTEM_START_BALANCE_PERCENT": {
      const startBalance = await deps.runStartBalanceStore.getOrSet(params.runId, params.sourceAsset, () =>
        deps.chainReader.getBalance(sourceToken.tokenAddress, params.walletAddress),
      );
      return applyPercent(startBalance, params.amountValue);
    }

    default: {
      const exhaustive: never = params.amountType;
      throw new SwapExecutionError("INVALID_AMOUNT_TYPE", false, `Unknown amountType "${exhaustive}"`);
    }
  }
}

/** In-memory `RunStartBalanceStore` — see the FLAG above re: persistence across restarts. */
export class InMemoryRunStartBalanceStore implements RunStartBalanceStore {
  private readonly cache = new Map<string, bigint>();

  async getOrSet(runId: string, assetId: string, fetchBalance: () => Promise<bigint>): Promise<bigint> {
    const key = `${runId}:${assetId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const balance = await fetchBalance();
    this.cache.set(key, balance);
    return balance;
  }
}
