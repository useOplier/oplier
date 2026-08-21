import { describe, expect, test } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

/**
 * Part I additions to the engine's behaviour, all three of which came out of wiring the real
 * D/E/F implementations in:
 *
 *  1. Balance reconciliation (doc 05 §16) — positions/transactions are written from the
 *     receipt's ACTUAL on-chain amounts, not a hardcoded placeholder.
 *  2. The "don't fabricate a cost basis" branch — a SUCCESS receipt with no reconcilable
 *     amounts records the transaction but leaves the position untouched.
 *  3. The authorization gate — a System with no live Smart Session permission halts instead
 *     of submitting an unauthorized swap (doc 02, locked).
 */
describe("reconciliation of real fill amounts (doc 05 §16)", () => {
  test("position cost basis and quantity come from the receipt, not a placeholder", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    // A genuinely non-unit fill: 250 USDG in, 1.25 AAPLx out.
    swapExecutor.setDefaultOutcome({ kind: "success", amountIn: "250", amountOut: "1.25" });
    priceProvider.set("aaplx", 200);

    const system = await engine.createSystem("0xwallet", singleStepPriceSpec());
    priceProvider.set("aaplx", 185); // FALSE -> TRUE
    await engine.tick(["PRICE_VALUE"]);

    const position = await repository.getPosition(system.id, "aaplx");
    expect(position).not.toBeNull();
    expect(position!.quantity).toBe("1.25");
    expect(position!.costBasis).toBe("250");
  });

  test("transaction row carries the real amounts, block number, and its execution id", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    swapExecutor.setDefaultOutcome({ kind: "success", amountIn: "250", amountOut: "1.25" });
    priceProvider.set("aaplx", 200);

    const system = await engine.createSystem("0xwallet", singleStepPriceSpec());
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);

    const txs = [...repository.transactions.values()];
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amountIn).toBe("250");
    expect(txs[0]!.amountOut).toBe("1.25");
    expect(txs[0]!.blockNumber).not.toBeNull();
    // Previously always null — this is what joins an Activity row back to its execution.
    expect(txs[0]!.executionId).not.toBeNull();

    const execution = await repository.getExecution(txs[0]!.executionId!);
    expect(execution).not.toBeNull();
    expect(execution!.systemId).toBe(system.id);
  });

  test("ROI evaluates against the reconciled cost basis", async () => {
    // 250 in / 1.25 out => break-even at 200. At 260 the position is +30%.
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    swapExecutor.setDefaultOutcome({ kind: "success", amountIn: "250", amountOut: "1.25" });
    priceProvider.set("aaplx", 200);

    const system = await engine.createSystem("0xwallet", {
      ...singleStepPriceSpec(),
      executionLimit: 5,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "LT", value: 190 } }],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 250 },
        },
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "ROI", parameters: { asset: "aaplx", direction: "UP", percent: 25 } }],
          swap: { sourceAsset: "aaplx", destinationAsset: "usdg", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
        },
      ],
    });

    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);
    const position = await repository.getPosition(system.id, "aaplx");
    expect(position!.costBasis).toBe("250");

    // +20% (240) must NOT trigger a +25% ROI condition...
    priceProvider.set("aaplx", 240);
    await engine.tick(["ROI"]);
    let current = await repository.getSystem(system.id);
    expect(current!.status).toBe("ACTIVE");

    // ...but +30% (260) must.
    priceProvider.set("aaplx", 260);
    await engine.tick(["ROI"]);
    current = await repository.getSystem(system.id);
    expect(current!.status).toBe("COMPLETE");
  });

  test("a SUCCESS receipt with no reconcilable amounts records the tx but never invents a cost basis", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    swapExecutor.setDefaultOutcome({ kind: "success-unreconciled" });
    priceProvider.set("aaplx", 200);

    const system = await engine.createSystem("0xwallet", singleStepPriceSpec());
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);

    // No fabricated position — this is the branch that used to write costBasis "1".
    expect(await repository.getPosition(system.id, "aaplx")).toBeNull();

    // The swap still happened, so Activity must still show it, with nulls making the gap visible.
    const txs = [...repository.transactions.values()];
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amountIn).toBeNull();
    expect(txs[0]!.amountOut).toBeNull();
    expect(txs[0]!.status).toBe("SUCCESS");
  });
});

describe("authorization gate (doc 02 — blocked, never auto-expanded)", () => {
  test("a System whose permission was revoked halts instead of submitting", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xwallet", singleStepPriceSpec());

    // Simulate the permission being revoked out from under an ACTIVE System (e.g. an
    // out-of-band revocation, or a revoke that landed while the System stayed ACTIVE).
    await repository.revokeActivePermission(system.id);

    priceProvider.set("aaplx", 185); // condition goes FALSE -> TRUE
    const results = await engine.tick(["PRICE_VALUE"]);

    expect(results[0]!.outcome).toBe("no-active-permission-halted");
    // Critically: no transaction was ever submitted.
    expect(swapExecutor.submittedParams).toHaveLength(0);
    const current = await repository.getSystem(system.id);
    expect(current!.status).toBe("HALTED");
  });

  test("the executor receives the active permissionRef, runId and a future deadline", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xwallet", singleStepPriceSpec());

    priceProvider.set("aaplx", 185);
    const before = Date.now();
    await engine.tick(["PRICE_VALUE"]);

    expect(swapExecutor.submittedParams).toHaveLength(1);
    const params = swapExecutor.submittedParams[0]!;

    const active = await repository.getActivePermission(system.id);
    expect(params.permissionRef).toBe(active!.sessionReference);

    const run = await repository.getCurrentRun(system.id);
    expect(params.runId).toBe(run!.id);

    // Fixed 5-minute policy (SWAP_DEADLINE_SECONDS) — must be in the future.
    expect(params.deadline.getTime()).toBeGreaterThan(before);
  });
});
