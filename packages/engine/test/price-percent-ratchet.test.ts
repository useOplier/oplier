import { describe, expect, it } from "vitest";
import { makeHarness } from "./helpers.js";
import type { SystemSpec } from "../src/types.js";

/**
 * doc 01 §1: "Set a system that buys $10 worth of AAPL every time it drops 5%, until I own
 * $50 worth." Modeled here as 3 sequential steps, each a -5% PRICE_PERCENT buy on the same
 * asset -- the only way this behaves as described is if each step's -5% is measured from the
 * PREVIOUS step's execution price, not from a single fixed System-creation-time price.
 */
function accumulationSpec(): SystemSpec {
  const step = () => ({
    groupOperator: "AND" as const,
    conditions: [{ conditionType: "PRICE_PERCENT" as const, parameters: { asset: "aaplx", direction: "DOWN" as const, percent: 5 } }],
    swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED" as const, amountValue: 10 },
  });
  return {
    name: "Accumulate on dips",
    maxAllocation: 100,
    maxAllocationAsset: "usdg",
    executionLimit: 3,
    steps: [step(), step(), step()],
  };
}

describe("PRICE_PERCENT ratcheting baseline", () => {
  it("re-baselines to the price at each successful execution, not a single fixed reference", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 200); // System-creation-time price
    const system = await engine.createSystem("0xWallet", accumulationSpec());
    const steps = await repository.listStepsForSystem(system.id);

    // Step 1 has no prior execution to ratchet from, so its baseline is captured lazily on
    // its first evaluation (`BaselinePriceStore.getOrSet`) -- pin that explicitly with a
    // tick while price is still 200, so the rest of this test is deterministic rather than
    // depending on whatever price happened to be set before the first tick.
    let results = await engine.tick(["PRICE_PERCENT"]);
    expect(results.filter((r) => r.triggeredStepId === steps[0].step.id)).toHaveLength(0); // 0% change, no trigger

    // -5% from the 200 baseline = 190.
    priceProvider.set("aaplx", 195); // only -2.5% from 200 -- not enough yet
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results.filter((r) => r.triggeredStepId === steps[0].step.id)).toHaveLength(0);

    priceProvider.set("aaplx", 190); // -5% from 200 -- step 1 fires
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results[0].outcome).toBe("succeeded");
    let run = await repository.getRun(system.currentRunId!);
    expect(run!.currentStepId).toBe(steps[1].step.id);

    // If the baseline were still fixed at 200, step 2 would need price <= 190 (already true!)
    // and would fire immediately. The ratcheted baseline is 190 (step 1's execution price),
    // so step 2 needs -5% from 190 = 180.5 -- price sitting at 190 must NOT trigger it.
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results.filter((r) => r.triggeredStepId === steps[1].step.id)).toHaveLength(0);
    run = await repository.getRun(system.currentRunId!);
    expect(run!.currentStepId).toBe(steps[1].step.id); // still waiting on step 2

    priceProvider.set("aaplx", 180); // -5.3% from the ratcheted 190 baseline -- fires
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results[0].outcome).toBe("succeeded");
    run = await repository.getRun(system.currentRunId!);
    expect(run!.currentStepId).toBe(steps[2].step.id);

    // Step 3's baseline ratchets again, to 180 (step 2's execution price). -5% from 180 = 171.
    priceProvider.set("aaplx", 175); // only -2.8% from 180 -- not enough
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results.filter((r) => r.triggeredStepId === steps[2].step.id)).toHaveLength(0);

    priceProvider.set("aaplx", 170); // past -5% from 180 -- fires, System completes
    results = await engine.tick(["PRICE_PERCENT"]);
    expect(results[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });
});