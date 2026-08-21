import {
  InMemorySystemRepository,
  MockNewsDataProvider,
  MockPermissionService,
  MockPriceDataProvider,
  MockSwapExecutor,
  UpmEngine,
} from "../src/index.js";
import type { SystemSpec } from "../src/types.js";

export function makeHarness(options?: { receiptPollConfig?: { pollIntervalMs: number; maxWaitMs: number } }) {
  const repository = new InMemorySystemRepository();
  const priceProvider = new MockPriceDataProvider();
  const newsProvider = new MockNewsDataProvider();
  const permissionService = new MockPermissionService();
  const swapExecutor = new MockSwapExecutor();
  const engine = new UpmEngine({
    repository,
    priceProvider,
    newsProvider,
    permissionService,
    swapExecutor,
    // Fast by default so the suite doesn't wait out the real 3s/45s production defaults;
    // individual tests can still override via `options.receiptPollConfig`.
    receiptPollConfig: options?.receiptPollConfig ?? { pollIntervalMs: 2, maxWaitMs: 10 },
  });
  return { repository, priceProvider, newsProvider, permissionService, swapExecutor, engine };
}

export function singleStepPriceSpec(overrides?: Partial<SystemSpec>): SystemSpec {
  return {
    name: "Test System",
    maxAllocation: 1000,
    maxAllocationAsset: "usdg",
    executionLimit: 3,
    steps: [
      {
        groupOperator: "AND",
        conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "LT", value: 190 } }],
        swap: {
          sourceAsset: "usdg",
          destinationAsset: "aaplx",
          amountType: "FIXED",
          amountValue: 100,
        },
      },
    ],
    ...overrides,
  };
}

export function twoStepPriceSpec(): SystemSpec {
  return {
    name: "Two Step System",
    maxAllocation: 1000,
    maxAllocationAsset: "usdg",
    executionLimit: 3,
    steps: [
      {
        groupOperator: "AND",
        conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "LT", value: 190 } }],
        swap: { sourceAsset: "usdg", destinationAsset: "aaplx", amountType: "FIXED", amountValue: 100 },
      },
      {
        groupOperator: "AND",
        conditions: [{ conditionType: "PRICE_VALUE", parameters: { asset: "aaplx", operator: "GT", value: 210 } }],
        swap: { sourceAsset: "aaplx", destinationAsset: "usdg", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
      },
    ],
  };
}