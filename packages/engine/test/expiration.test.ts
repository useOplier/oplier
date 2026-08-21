import { describe, expect, it } from "vitest";
import { makeHarness, singleStepPriceSpec } from "./helpers.js";

describe("expiration", () => {
  it("expires a System once expiresAt has passed, independent of any condition state", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 200); // condition never satisfied — expiration is unrelated to it

    const spec = singleStepPriceSpec({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const system = await engine.createSystem("0xWallet", spec);
    expect(system.status).toBe("ACTIVE");

    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results.find((r) => r.systemId === system.id)?.outcome).toBe("expired");

    const expired = await repository.getSystem(system.id);
    expect(expired!.status).toBe("EXPIRED");
    const run = await repository.getRun(expired!.currentRunId!);
    expect(run!.status).toBe("EXPIRED");
  });

  it("does not expire a System whose expiresAt is in the future", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 200);
    const spec = singleStepPriceSpec({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const system = await engine.createSystem("0xWallet", spec);

    await engine.tick(["PRICE_VALUE"]);
    const stillActive = await repository.getSystem(system.id);
    expect(stillActive!.status).toBe("ACTIVE");
  });
});
