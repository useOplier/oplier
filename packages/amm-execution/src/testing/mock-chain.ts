import type {
  ChainReader,
  SessionKeyTransactionSender,
  ChainTransactionReceipt,
  SubmittedTx,
} from "../types.js";
import type { SwapCalldataEncoder, SwapExactTokensForTokensCallParams } from "../execution/calldata-encoder.js";

/**
 * In-memory chain double for tests — no network, per the task's "write and test against
 * mocks" instruction. Models exactly the state this package reads: pair reserves and ERC20
 * balances, keyed by address (lowercased for case-insensitive lookups, matching real chain
 * address comparisons elsewhere in this package).
 */
export class MockChainReader implements ChainReader {
  private reserves = new Map<string, { reserve0: bigint; reserve1: bigint; token0: string; token1: string }>();
  private balances = new Map<string, bigint>();
  private blockNumber = 1_000_000;

  setReserves(pairAddress: string, reserve0: bigint, reserve1: bigint, token0: string, token1: string): void {
    this.reserves.set(pairAddress.toLowerCase(), { reserve0, reserve1, token0, token1 });
  }

  setBalance(token: string, owner: string, balance: bigint): void {
    this.balances.set(this.balanceKey(token, owner), balance);
  }

  private balanceKey(token: string, owner: string): string {
    return `${token.toLowerCase()}:${owner.toLowerCase()}`;
  }

  async getReserves(pairAddress: string) {
    const entry = this.reserves.get(pairAddress.toLowerCase());
    if (!entry) {
      // Matches on-chain reality for a pair that was never seeded: reserves read as zero,
      // not a revert (a real UniswapV2Pair.getReserves() call always succeeds and returns
      // (0,0,0) for an empty/never-swapped pair).
      return { reserve0: 0n, reserve1: 0n, token0: "", token1: "" };
    }
    return entry;
  }

  async getBalance(token: string, owner: string): Promise<bigint> {
    return this.balances.get(this.balanceKey(token, owner)) ?? 0n;
  }

  async getBlockNumber(): Promise<number> {
    return this.blockNumber;
  }

  advanceBlock(by = 1): void {
    this.blockNumber += by;
  }
}

export type ScriptedOutcome =
  | { kind: "success"; amount0Out: bigint; amount1Out: bigint; blockDelay?: number }
  | { kind: "revert"; revertReason: string; blockDelay?: number }
  | { kind: "pending-forever" };

/**
 * Scriptable session-key sender double. `.queueOutcome(txHash-independent, outcome)` isn't
 * needed — instead, the outcome is set per-call via `.setNextOutcome`, since each test scripts
 * exactly one swap's fate at a time (matches how `mock-swap-executor.ts` in Part C's own
 * engine works — `.setDefaultOutcome` / `.queueFor`).
 */
export class MockSessionKeyTransactionSender implements SessionKeyTransactionSender {
  private outcomes = new Map<string, ScriptedOutcome>();
  private receipts = new Map<string, ChainTransactionReceipt | null>();
  private pendingPollCounts = new Map<string, number>();
  private txCounter = 0;
  private currentBlock = 1_000_000;
  private pairAddressForNextSend: string | undefined;

  /** Sets the outcome the *next* `send()` call will resolve to once polled enough times. */
  setNextOutcome(outcome: ScriptedOutcome, pairAddress?: string): void {
    this.nextOutcome = outcome;
    this.pairAddressForNextSend = pairAddress;
  }

  private nextOutcome: ScriptedOutcome | undefined;

  async send(_params: { to: string; data: string; permissionRef: string }): Promise<SubmittedTx> {
    this.txCounter += 1;
    const txHash = `0xmocktx${this.txCounter.toString().padStart(6, "0")}`;
    const outcome = this.nextOutcome ?? { kind: "success", amount0Out: 0n, amount1Out: 0n };
    this.outcomes.set(txHash, outcome);
    this.pendingPollCounts.set(txHash, 0);
    this.nextOutcome = undefined;
    return { txHash };
  }

  async getTransactionReceipt(txHash: string): Promise<ChainTransactionReceipt | null> {
    const outcome = this.outcomes.get(txHash);
    if (!outcome) return null;

    if (outcome.kind === "pending-forever") return null;

    const priorPolls = this.pendingPollCounts.get(txHash) ?? 0;
    const requiredPolls = outcome.blockDelay ?? 0;
    if (priorPolls < requiredPolls) {
      this.pendingPollCounts.set(txHash, priorPolls + 1);
      return null;
    }

    const pairAddress = this.pairAddressForNextSend ?? "0xpair";
    if (outcome.kind === "revert") {
      return {
        status: "reverted",
        blockNumber: this.currentBlock++,
        revertReason: outcome.revertReason,
        logs: [],
      };
    }

    return {
      status: "success",
      blockNumber: this.currentBlock++,
      logs: [{ address: pairAddress, topics: [], data: "0x" }],
    };
  }
}

/** No-op calldata encoder for tests that don't inspect the encoded bytes themselves. */
export class RecordingCalldataEncoder implements SwapCalldataEncoder {
  public lastCall: SwapExactTokensForTokensCallParams | undefined;

  encodeSwapExactTokensForTokens(params: SwapExactTokensForTokensCallParams): string {
    this.lastCall = params;
    return "0xdeadbeef";
  }
}
