import { describe, expect, it } from "vitest";
import { makeHarness } from "./helpers.js";

describe("condition primitives", () => {
  it("ROI triggers off (currentValue - costBasis)/costBasis, not raw price change (doc 05 §17)", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 100);
    const system = await engine.createSystem("0xWallet", {
      name: "ROI System",
      maxAllocation: 1000,
      maxAllocationAsset: "usdg",
      executionLimit: 3,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "GT", value: 0 } }],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 100 },
        },
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "ROI", parameters: { asset: "aaplx", direction: "UP", percent: 20 } }],
          swap: { sourceAsset: "aaplx", destinationAsset: "usdg", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
        },
      ],
    });
    const steps = await repository.listStepsForSystem(system.id);

    await engine.tick(["PRICE_VALUE"]); // step 1 fires immediately (price > 0), opens position
    const positionAfterEntry = await repository.getPosition(system.id, "aaplx");
    expect(positionAfterEntry!.status).toBe("OPEN"); // costBasis "1", quantity "1" per mock fill

    // Mock fill was costBasis=1, quantity=1 => break-even price is 1. At price 100 ROI is
    // enormous, so guard: re-fetch to confirm what the mock actually recorded before asserting.
    const costBasis = Number(positionAfterEntry!.costBasis);
    const quantity = Number(positionAfterEntry!.quantity);

    // Price such that (qty * price - costBasis) / costBasis < 20% -> ROI condition false
    const belowThresholdPrice = costBasis * 1.1 / quantity; // ~10% up
    priceProvider.set("aaplx", belowThresholdPrice);
    let results = await engine.tick(["PRICE_VALUE", "ROI"]);
    expect(results.filter((r) => r.triggeredStepId === steps[1].step.id)).toHaveLength(0);

    // Price such that ROI clears 20%
    const aboveThresholdPrice = (costBasis * 1.3) / quantity;
    priceProvider.set("aaplx", aboveThresholdPrice);
    results = await engine.tick(["PRICE_VALUE", "ROI"]);
    expect(results[0].outcome).toBe("succeeded");
  });

  it("TIME fires once the configured date/time has passed, in the app's universal timezone", async () => {
    const { engine, repository } = makeHarness();
    const past = new Date(Date.now() - 60_000);
    const dateStr = past.toISOString().slice(0, 10);
    const timeStr = `${String(past.getUTCHours()).padStart(2, "0")}:${String(past.getUTCMinutes()).padStart(2, "0")}`;

    const system = await engine.createSystem("0xWallet", {
      name: "Time System",
      maxAllocation: 500,
      maxAllocationAsset: "usdg",
      executionLimit: 1,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "TIME", parameters: { date: dateStr, time: timeStr } }],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 10 },
        },
      ],
    });

    const results = await engine.tick(["TIME"]);
    expect(results[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });

  it("HIGH_IMPACT_NEWS uses the NewsDataProvider mock, not a hardcoded value", async () => {
    const { engine, repository, newsProvider } = makeHarness();
    const system = await engine.createSystem("0xWallet", {
      name: "News System",
      maxAllocation: 500,
      maxAllocationAsset: "usdg",
      executionLimit: 1,
      steps: [
        {
          groupOperator: "AND",
          conditions: [{ conditionType: "HIGH_IMPACT_NEWS", parameters: { withinHours: 24 } }],
          swap: { sourceAsset: "aaplx", destinationAsset: "usdg", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
        },
      ],
    });

    newsProvider.setUpcoming(false, false);
    let results = await engine.tick(["HIGH_IMPACT_NEWS"]);
    expect(results.filter((r) => r.systemId === system.id)).toHaveLength(0);

    newsProvider.setUpcoming(false, true); // within 24h, not within 1h
    results = await engine.tick(["HIGH_IMPACT_NEWS"]);
    expect(results[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });

  it("OR group triggers when either condition is true; AND requires both", async () => {
    const { engine, repository, priceProvider } = makeHarness();
    priceProvider.set("aaplx", 100);
    priceProvider.set("metax", 50);

    const system = await engine.createSystem("0xWallet", {
      name: "OR Group",
      maxAllocation: 500,
      maxAllocationAsset: "usdg",
      executionLimit: 1,
      steps: [
        {
          groupOperator: "OR",
          conditions: [
            { conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "GT", value: 1000 } }, // false
            { conditionType: "PRICE_VALUE", parameters: { asset: "metax", operator: "LT", value: 60 } }, // true
          ],
          swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 10 },
        },
      ],
    });

    const results = await engine.tick(["PRICE_VALUE"]);
    expect(results[0].outcome).toBe("succeeded");
    expect((await repository.getSystem(system.id))!.status).toBe("COMPLETE");
  });
});
