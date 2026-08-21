import { describe, expect, it } from "vitest";
import { makeHarness, twoStepPriceSpec } from "./helpers.js";

describe("walkthrough: creation -> trigger -> swap -> next step -> completion", () => {
  it("walks a two-step System end to end", async () => {
    const { engine, repository, priceProvider, permissionService } = makeHarness();

    priceProvider.set("aaplx", 200); // step 1 condition (LT 190) starts false
    priceProvider.set("usdg", 1);

    const system = await engine.createSystem("0xWallet", twoStepPriceSpec());
    expect(system.status).toBe("ACTIVE");
    expect(system.currentRunId).toBeTruthy();
    expect(permissionService.created).toHaveLength(1); // Nexus permission created on creation

    const run1 = await repository.getRun(system.currentRunId!);
    const steps = await repository.listStepsForSystem(system.id);
    expect(run1!.currentStepId).toBe(steps[0].step.id);

    // Price still above threshold -> no trigger
    let results = await engine.tick(["PRICE_VALUE"]);
    expect(results.filter((r) => r.systemId === system.id)).toHaveLength(0);
    let runStill = await repository.getRun(system.currentRunId!);
    expect(runStill!.currentStepId).toBe(steps[0].step.id);

    // Price drops below 190 -> step 1 triggers, swap succeeds, advances to step 2
    priceProvider.set("aaplx", 185);
    results = await engine.tick(["PRICE_VALUE"]);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("succeeded");

    const afterStep1 = await repository.getSystem(system.id);
    expect(afterStep1!.status).toBe("ACTIVE"); // one more step to go
    const runAfterStep1 = await repository.getRun(system.currentRunId!);
    expect(runAfterStep1!.currentStepId).toBe(steps[1].step.id);

    const exec1 = await repository.getExecutionForStep(run1!.id, steps[0].step.id);
    expect(exec1!.state).toBe("COMPLETED");
    expect(exec1!.status).toBe("SUCCESS");

    // Step 2 condition (GT 210) not yet true
    results = await engine.tick(["PRICE_VALUE"]);
    expect(results.filter((r) => r.triggeredStepId === steps[1].step.id)).toHaveLength(0);

    // Price rises above 210 -> step 2 triggers -> System completes
    priceProvider.set("aaplx", 220);
    results = await engine.tick(["PRICE_VALUE"]);
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe("succeeded");

    const finalSystem = await repository.getSystem(system.id);
    expect(finalSystem!.status).toBe("COMPLETE");
    const finalRun = await repository.getRun(system.currentRunId!);
    expect(finalRun!.status).toBe("COMPLETE");

    const exec2 = await repository.getExecutionForStep(run1!.id, steps[1].step.id);
    expect(exec2!.state).toBe("COMPLETED");

    // Position closed on completion (doc 06 §8)
    const position = await repository.getPosition(system.id, "aaplx");
    expect(position!.status).toBe("CLOSED");
  });

  it("does not re-attempt an already-completed step even if its condition re-satisfies", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", {
      name: "Single",
      maxAllocation: 500,
      maxAllocationAsset: "usdg",
      executionLimit: 3,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "LT", value: 190 } }],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 50 },
        },
      ],
    });

    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);
    const submittedAfterFirst = swapExecutor.submittedParams.length;
    expect(submittedAfterFirst).toBe(1);

    const finalSystem = await repository.getSystem(system.id);
    expect(finalSystem!.status).toBe("COMPLETE"); // only step, so completes immediately

    // Condition flips false then true again on a completed System — should be a no-op
    priceProvider.set("aaplx", 195);
    await engine.tick(["PRICE_VALUE"]);
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);

    expect(swapExecutor.submittedParams.length).toBe(submittedAfterFirst); // no new submission
  });
});
