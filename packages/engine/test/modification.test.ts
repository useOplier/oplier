import { describe, expect, it } from "vitest";
import { makeHarness, twoStepPriceSpec } from "./helpers.js";

describe("modification", () => {
  it("modifies only the targeted step's condition/swap, without restarting the current run", async () => {
    const { engine, repository, priceProvider, permissionService } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", twoStepPriceSpec());
    const steps = await repository.listStepsForSystem(system.id);
    const runIdBefore = system.currentRunId;

    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]); // advance to step 2, run still in progress
    const runAfterStep1 = await repository.getRun(runIdBefore!);
    expect(runAfterStep1!.currentStepId).toBe(steps[1].step.id);

    expect(permissionService.created).toHaveLength(1);
    expect(permissionService.revoked).toHaveLength(0);

    // Modify step 2's condition threshold from GT 210 to GT 300 — should not touch run/step
    // progress, and should revoke the old permission + create a new one (doc 05 §30).
    await engine.modifySystem(
      system.id,
      {},
      {
        stepId: steps[1].step.id,
        conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "GT", value: 300 } }],
      },
    );

    expect(permissionService.revoked).toHaveLength(1);
    expect(permissionService.created).toHaveLength(2);

    const runAfterModification = await repository.getRun(runIdBefore!);
    expect(runAfterModification!.currentStepId).toBe(steps[1].step.id); // unchanged, not restarted
    expect(runAfterModification!.status).toBe("ACTIVE");

    // Old threshold (210) no longer triggers step 2; new threshold (300) does.
    priceProvider.set("aaplx", 220);
    let results = await engine.tick(["PRICE_VALUE"]);
    expect(results.filter((r) => r.triggeredStepId === steps[1].step.id)).toHaveLength(0);

    priceProvider.set("aaplx", 305);
    results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });

  it("modifies top-level fields (name, executionLimit) without touching steps or permissions", async () => {
    const { engine, repository, permissionService } = makeHarness();
    const system = await engine.createSystem("0xWallet", twoStepPriceSpec());
    expect(permissionService.created).toHaveLength(1);

    const updated = await engine.modifySystem(system.id, { name: "Renamed System", executionLimit: 5 });
    expect(updated.name).toBe("Renamed System");
    expect(updated.executionLimit).toBe(5);
    expect(permissionService.revoked).toHaveLength(0); // top-level-only patch, no permission churn

    const system2 = await repository.getSystem(system.id);
    expect(system2!.currentRunId).toBe(system.currentRunId); // run untouched
  });
});
