import { describe, expect, it } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

describe("execution_limit enforcement", () => {
  it("halts the System once attemptCount reaches systems.executionLimit", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const spec = singleStepPriceSpec();
    spec.executionLimit = 2;
    const system = await engine.createSystem("0xWallet", spec);
    const steps = await repository.listStepsForSystem(system.id);

    swapExecutor.setDefaultOutcome({ kind: "retryable-failure" });
    priceProvider.set("aaplx", 185);

    const r1 = await engine.tick(["PRICE_VALUE"]);
    expect(r1[0].outcome).toBe("failed-retryable");
    let exec = await repository.getExecutionForStep((await repository.getSystem(system.id))!.currentRunId!, steps[0].step.id);
    expect(exec!.attemptCount).toBe(1);
    expect((await repository.getSystem(system.id))!.status).toBe("ACTIVE"); // limit is 2, not hit yet

    const r2 = await engine.tick(["PRICE_VALUE"]);
    expect(r2[0].outcome).toBe("limit-reached-halted");

    const halted = await repository.getSystem(system.id);
    expect(halted!.status).toBe("HALTED");
    exec = await repository.getExecutionForStep(halted!.currentRunId!, steps[0].step.id);
    expect(exec!.attemptCount).toBe(2);

    // Further ticks while halted don't submit more transactions
    const submittedBeforeMoreTicks = swapExecutor.submittedParams.length;
    await engine.tick(["PRICE_VALUE"]);
    expect(swapExecutor.submittedParams.length).toBe(submittedBeforeMoreTicks);
  });

  it("execution_limit caps retries of the same step only — distinct steps each get their own budget", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", {
      name: "Two steps, tight limit",
      maxAllocation: 1000,
      maxAllocationAsset: "usdg",
      executionLimit: 1,
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

    priceProvider.set("aaplx", 185);
    const r1 = await engine.tick(["PRICE_VALUE"]); // step 1, first attempt, executionLimit=1 -> succeeds on first try, never hits the cap
    expect(r1[0].outcome).toBe("succeeded");

    priceProvider.set("aaplx", 220);
    const r2 = await engine.tick(["PRICE_VALUE"]); // step 2, its own fresh attempt budget
    expect(r2[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });
});

describe("duplicate-execution protection", () => {
  it("createExecutionIfAbsent is the atomic lock — concurrent callers for the same triple only one wins", async () => {
    const { repository } = makeHarness();
    const [a, b, c] = await Promise.all([
      repository.createExecutionIfAbsent("sys1", "run1", "step1"),
      repository.createExecutionIfAbsent("sys1", "run1", "step1"),
      repository.createExecutionIfAbsent("sys1", "run1", "step1"),
    ]);
    const winners = [a, b, c].filter((x) => x !== null);
    expect(winners).toHaveLength(1);
  });

  it("a second concurrent tick backs off with attempt-in-progress-elsewhere instead of double-submitting", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    priceProvider.set("aaplx", 185);

    // Simulate two workers racing on the same triggered step: run two ticks back-to-back
    // without awaiting swap resolution in between by calling tick() twice in parallel.
    const [r1, r2] = await Promise.all([engine.tick(["PRICE_VALUE"]), engine.tick(["PRICE_VALUE"])]);
    const outcomes = [...r1, ...r2].map((r) => r.outcome);
    expect(outcomes.filter((o) => o === "succeeded" || o === "failed-retryable" || o === "failed-non-retryable-halted")).toHaveLength(1);
    expect(swapExecutor.submittedParams).toHaveLength(1); // exactly one transaction submitted, never two

    const finalSystem = await repository.getSystem(system.id);
    expect(finalSystem!.status).toBe("COMPLETE");
  });
});
