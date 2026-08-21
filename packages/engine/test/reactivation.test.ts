import { describe, expect, it } from "vitest";
import { makeHarness, twoStepPriceSpec } from "./helpers.js";

describe("reactivation", () => {
  it("reactivating a COMPLETE System starts a new run at Step 1 with reset condition state", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", twoStepPriceSpec());
    const steps = await repository.listStepsForSystem(system.id);
    const firstRunId = system.currentRunId!;

    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]); // step 1
    priceProvider.set("aaplx", 220);
    await engine.tick(["PRICE_VALUE"]); // step 2 -> complete

    const completed = await repository.getSystem(system.id);
    expect(completed!.status).toBe("COMPLETE");
    const positionAfterCompletion = await repository.getPosition(system.id, "aaplx");
    expect(positionAfterCompletion!.status).toBe("CLOSED");
    const costBasisAfterRun1 = positionAfterCompletion!.costBasis;

    const reactivated = await engine.reactivateSystem(system.id);
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.currentRunId).not.toBe(firstRunId); // new run_id (doc 05 §21-22)

    const newRun = await repository.getRun(reactivated.currentRunId!);
    expect(newRun!.currentStepId).toBe(steps[0].step.id); // starts at Step 1, not where it left off
    expect(newRun!.runNumber).toBe(2);

    // Old run's history is preserved, not deleted
    const oldRun = await repository.getRun(firstRunId);
    expect(oldRun).not.toBeNull();
    expect(oldRun!.status).toBe("COMPLETE");
    const oldExec = await repository.getExecutionForStep(firstRunId, steps[0].step.id);
    expect(oldExec).not.toBeNull();

    // Condition currentState reset to false across the board (doc 05 §22 "no previous
    // condition-trigger state")
    const freshSteps = await repository.listStepsForSystem(system.id);
    for (const s of freshSteps) {
      for (const c of s.conditions) expect(c.currentState).toBe(false);
    }

    // Position stays CLOSED immediately after reactivation — SCHEMA.md Design decision #2:
    // "status flips back to OPEN on the *next execution* after reactivation," not eagerly at
    // the reactivate call itself.
    const positionRightAfterReactivation = await repository.getPosition(system.id, "aaplx");
    expect(positionRightAfterReactivation!.status).toBe("CLOSED");
    expect(positionRightAfterReactivation!.costBasis).toBe(costBasisAfterRun1); // never reset to zero

    // New execution under the new run_id is what actually reopens it, cost basis accumulating
    // further via weighted average rather than resetting (doc 04 §7)
    priceProvider.set("aaplx", 185);
    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("succeeded");
    const newExec = await repository.getExecutionForStep(newRun!.id, steps[0].step.id);
    expect(newExec!.state).toBe("COMPLETED");

    const positionAfterNewFill = await repository.getPosition(system.id, "aaplx");
    expect(positionAfterNewFill!.status).toBe("OPEN");
    expect(positionAfterNewFill!.closedAt).toBeNull();
    expect(Number(positionAfterNewFill!.costBasis)).toBeGreaterThan(Number(costBasisAfterRun1)); // accumulated, not reset
  });

  it("rejects reactivating a System that is still ACTIVE", async () => {
    const { engine } = makeHarness();
    const system = await engine.createSystem("0xWallet", twoStepPriceSpec());
    await expect(engine.reactivateSystem(system.id)).rejects.toThrow(/Cannot reactivate/);
  });
});
