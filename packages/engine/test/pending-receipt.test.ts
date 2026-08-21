import { describe, expect, it } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

describe("PENDING receipt polling", () => {
  it("resolves normally if the receipt clears PENDING within the poll window", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness({
      receiptPollConfig: { pollIntervalMs: 2, maxWaitMs: 50 },
    });
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    priceProvider.set("aaplx", 185);

    // PENDING for the first 2 polls, then SUCCESS -- well within the 50ms/2ms window.
    swapExecutor.setDefaultOutcome({ kind: "pending-then", after: 2, then: { kind: "success" } });

    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("succeeded");

    const finalSystem = await repository.getSystem(system.id);
    expect(finalSystem!.status).toBe("COMPLETE"); // never surfaced as a halt -- resolved in time
  });

  it("halts with pending-timeout-halted (not FAILED) once maxWaitMs elapses while still PENDING", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness({
      receiptPollConfig: { pollIntervalMs: 2, maxWaitMs: 8 },
    });
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    const steps = await repository.listStepsForSystem(system.id);

    swapExecutor.setDefaultOutcome({ kind: "pending" }); // never resolves
    priceProvider.set("aaplx", 185);

    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("pending-timeout-halted");

    const halted = await repository.getSystem(system.id);
    expect(halted!.status).toBe("HALTED"); // still a halt, just not a classified failure

    const run = await repository.getRun(halted!.currentRunId!);
    expect(run!.status).toBe("HALTED");

    const exec = await repository.getExecutionForStep(run!.id, steps[0].step.id);
    expect(exec!.state).toBe("EXECUTING"); // holds the lock -- nothing auto-resubmits
    expect(exec!.status).toBe("PENDING"); // NOT "FAILED" -- pending isn't reverted
    expect(exec!.retryable).toBeNull(); // never classified, because never resolved
    expect(exec!.errorLog).toMatch(/still PENDING/);
    expect(exec!.txHash).toBeTruthy();

    // Position closing on this halt (doc 06 §8) only applies if a position already existed
    // to close -- this single-step spec never had a successful fill before timing out, so
    // there's nothing to close here. See the multi-step ratchet test for a case where a
    // position does exist before a later halt.
    const position = await repository.getPosition(system.id, "aaplx");
    expect(position).toBeNull();

    // No further ticks touch it while halted
    const submittedBefore = swapExecutor.submittedParams.length;
    await engine.tick(["PRICE_VALUE"]);
    expect(swapExecutor.submittedParams.length).toBe(submittedBefore);
  });

  it("resume re-polls the SAME txHash rather than resubmitting a new transaction", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness({
      receiptPollConfig: { pollIntervalMs: 2, maxWaitMs: 8 },
    });
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    const steps = await repository.listStepsForSystem(system.id);

    swapExecutor.setDefaultOutcome({ kind: "pending" });
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]); // times out -> pending-timeout-halted

    const submittedAfterTimeout = swapExecutor.submittedParams.length;
    expect(submittedAfterTimeout).toBe(1);

    const halted = await repository.getSystem(system.id);
    const execBefore = await repository.getExecutionForStep(halted!.currentRunId!, steps[0].step.id);
    const originalTxHash = execBefore!.txHash;

    // The transaction actually confirms while the System is sitting halted -- resume should
    // discover this via a recheck, not by submitting a fresh swap.
    swapExecutor.setDefaultOutcome({ kind: "success" });
    const resumed = await engine.resumeSystem(system.id);

    expect(swapExecutor.submittedParams.length).toBe(submittedAfterTimeout); // no new submission
    expect(resumed.status).toBe("COMPLETE"); // single-step spec completes on that resolved success

    const finalExec = await repository.getExecutionForStep(halted!.currentRunId!, steps[0].step.id);
    expect(finalExec!.txHash).toBe(originalTxHash); // same tx, not a new one
    expect(finalExec!.state).toBe("COMPLETED");
    expect(finalExec!.status).toBe("SUCCESS");
  });

  it("resume can re-halt with pending-timeout-halted again if the recheck also times out", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness({
      receiptPollConfig: { pollIntervalMs: 2, maxWaitMs: 8 },
    });
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());

    swapExecutor.setDefaultOutcome({ kind: "pending" }); // never resolves, ever
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]);

    const resumed = await engine.resumeSystem(system.id);
    expect(resumed.status).toBe("HALTED"); // re-halted, not silently left ACTIVE

    const run = await repository.getRun(resumed.currentRunId!);
    expect(run!.status).toBe("HALTED");
  });

  it("resume classifies a non-retryable failure discovered on recheck, and halts (not COMPLETE)", async () => {
    const { engine, repository, priceProvider, swapExecutor } = makeHarness({
      receiptPollConfig: { pollIntervalMs: 2, maxWaitMs: 8 },
    });
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());

    swapExecutor.setDefaultOutcome({ kind: "pending" });
    priceProvider.set("aaplx", 185);
    await engine.tick(["PRICE_VALUE"]); // pending-timeout-halted

    swapExecutor.setDefaultOutcome({ kind: "non-retryable-failure", errorLog: "reverted on-chain" });
    const resumed = await engine.resumeSystem(system.id);
    expect(resumed.status).toBe("HALTED");

    const run = await repository.getRun(resumed.currentRunId!);
    const steps = await repository.listStepsForSystem(system.id);
    const exec = await repository.getExecutionForStep(run!.id, steps[0].step.id);
    expect(exec!.status).toBe("FAILED");
    expect(exec!.retryable).toBe(false);
    expect(exec!.errorLog).toBe("reverted on-chain");
  });
});