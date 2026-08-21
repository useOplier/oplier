import { describe, expect, it } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

describe("pause/resume", () => {
  it("PAUSED freezes evaluation without revoking permissions or touching run/step state", async () => {
    const { engine, repository, priceProvider, permissionService } = makeHarness();
    priceProvider.set("aaplx", 200);
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    expect(permissionService.revoked).toHaveLength(0);

    const paused = await engine.pauseSystem(system.id);
    expect(paused.status).toBe("PAUSED");
    expect(permissionService.revoked).toHaveLength(0); // doc 05 §26

    // While paused, price moving into trigger range should NOT fire anything —
    // listActiveSystems only returns ACTIVE Systems.
    priceProvider.set("aaplx", 185);
    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results.filter((r) => r.systemId === system.id)).toHaveLength(0);

    const resumed = await engine.resumeSystem(system.id);
    expect(resumed.status).toBe("ACTIVE");
    expect(resumed.currentRunId).toBe(system.currentRunId); // same run, not restarted

    const afterResume = await engine.tick(["PRICE_VALUE"]);
    expect(afterResume[0].outcome).toBe("succeeded");
  });

  it("rejects an illegal transition (e.g. pausing an already-HALTED System)", async () => {
    const { engine } = makeHarness();
    const system = await engine.createSystem("0xWallet", singleStepPriceSpec());
    await expect(async () => {
      // fabricate an illegal call path: pause twice in a row from PAUSED (only ACTIVE->PAUSED allowed)
      await engine.pauseSystem(system.id);
      await engine.pauseSystem(system.id);
    }).rejects.toThrow(/Illegal System transition/);
  });
});
