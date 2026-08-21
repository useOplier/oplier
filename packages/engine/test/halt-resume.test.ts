import { describe, expect, it } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

describe("failure classification & halt/resume", () => {
  it("halts the System immediately on a non-retryable failure, and resume retries the same step", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    const steps = await repository.listStepsForSystem(system.id);

    swapExecutor.setDefaultOutcome({ kind: "non-retryable-failure", errorLog: "allowance too low" });
    priceProvider.set("aaplx", 185); // trigger

    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("failed-non-retryable-halted");

    const halted = await repository.getSystem(system.id);
    expect(halted!.status).toBe("HALTED");
    const run = await repository.getRun(halted!.currentRunId!);
    expect(run!.status).toBe("HALTED");

    const exec = await repository.getExecutionForStep(run!.id, steps[0].step.id);
    expect(exec!.retryable).toBe(false);
    expect(exec!.errorLog).toBe("allowance too low");
    expect(exec!.state).not.toBe("COMPLETED");

    // Further ticks are no-ops while halted (run.status !== ACTIVE gates it)
    await engine.tick(["PRICE_VALUE"]);
    expect(swapExecutor.submittedParams).toHaveLength(1);

    // User fixes the underlying issue (e.g. approves allowance) and resumes
    swapExecutor.setDefaultOutcome({ kind: "success" });
    const resumed = await engine.resumeSystem(system.id);
    expect(resumed.status).toBe("ACTIVE");
    const runAfterResume = await repository.getRun(resumed.currentRunId!);
    expect(runAfterResume!.status).toBe("ACTIVE");
    expect(runAfterResume!.currentStepId).toBe(steps[0].step.id); // exact failed step, not Step 1 restart... (here it IS step 1, single-step spec)

    const afterResumeTick = await engine.tick(["PRICE_VALUE"]);
    expect(afterResumeTick[0].outcome).toBe("succeeded");
    const finalSystem = await repository.getSystem(system.id);
    expect(finalSystem!.status).toBe("COMPLETE");
  });

  it("resumes from the exact failed step (not Step 1) in a multi-step System", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", {
      name: "Multi",
      maxAllocation: 1000,
      maxAllocationAsset: "usdg",
      executionLimit: 3,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "LT", value: 190 } }],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 50 },
        },
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "GT", value: 210 } }],
          swap: { sourceAsset: "aaplx", destinationAsset: "usdg", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
        },
      ],
    });
    const steps = await repository.listStepsForSystem(system.id);

    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]); // step 1 succeeds

    swapExecutor.setDefaultOutcome({ kind: "non-retryable-failure" });
    priceProvider.set("aaplx", 220);
    await engine.tick(["PRICE_VALUE"]); // step 2 fails non-retryably

    const halted = await repository.getSystem(system.id);
    expect(halted!.status).toBe("HALTED");
    const run = await repository.getRun(halted!.currentRunId!);
    expect(run!.currentStepId).toBe(steps[1].step.id); // still on step 2, never reset to step 1

    swapExecutor.setDefaultOutcome({ kind: "success" });
    await engine.resumeSystem(system.id);
    const runAfterResume = await repository.getRun(halted!.currentRunId!);
    expect(runAfterResume!.currentStepId).toBe(steps[1].step.id);

    const finalTick = await engine.tick(["PRICE_VALUE"]);
    expect(finalTick[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });
});
