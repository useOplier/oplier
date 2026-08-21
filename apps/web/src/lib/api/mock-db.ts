import type {
  ActivityItem,
  AiInsight,
  ExecutionLogEntry,
  HighImpactNewsEvent,
  HoldingEntry,
  Position,
  SettingsResponse,
  SystemSpec,
} from "./types";
import type { ChatMessage, ChatThread } from "@/lib/llm/types";

// Mock data for the supported asset registry (docs.md "Supported assets"):
// AAPLx, METAx, NVDAx, GLDx as RWA examples, USDG as the settlement/quote
// stablecoin. Prices are intentionally "controlled" so pause/resume/delete
// and system-trigger demos are deterministic. Every UI component reads
// these symbols off the data object (assetSymbol / maxAllocationAsset /
// fromAsset / toAsset) rather than hardcoding a string, so swapping this
// mock data for a real registry response is a drop-in replacement.
export const mockHoldings: HoldingEntry[] = [
  { assetSymbol: "AAPLx", assetName: "Apple", quantity: 4.2, priceUsd: 196.4, valueUsd: 824.88, roiPercent: 6.1 },
  { assetSymbol: "NVDAx", assetName: "NVIDIA", quantity: 2.5, priceUsd: 248.1, valueUsd: 620.25, roiPercent: -3.4 },
  { assetSymbol: "GLDx", assetName: "Gold", quantity: 3.1, priceUsd: 221.7, valueUsd: 687.27, roiPercent: 1.8 },
];

export const mockNews: HighImpactNewsEvent[] = [
  {
    id: "news_cpi",
    event: "US CPI (YoY)",
    eventTimestamp: new Date(Date.now() + 1000 * 60 * 60 * 20).toISOString(),
    country: "US",
    eventType: "INFLATION",
    impactLevel: "HIGH",
  },
  {
    id: "news_fomc",
    event: "FOMC Rate Decision",
    eventTimestamp: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString(),
    country: "US",
    eventType: "MONETARY_POLICY",
    impactLevel: "HIGH",
  },
];

export const mockInsights: AiInsight[] = [
  {
    id: "insight_cpi",
    headline: "US CPI tomorrow, high impact",
    body: "You hold $824.88 in AAPLx. Here's why this matters.",
    relatedNewsId: "news_cpi",
  },
];

export const mockSystems: SystemSpec[] = [
  {
    id: "sys_1",
    name: "AAPLx dip buyer",
    status: "ACTIVE",
    maxAllocation: 50,
    maxAllocationAsset: "USDG",
    executionLimit: 5,
    expiresAt: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    steps: [
      {
        id: "step_1",
        label: "Buy $10 of AAPLx on -5%",
        conditions: [{ type: "PRICE_PERCENT", params: { asset: "AAPLx", direction: "DOWN", percent: 5 } }],
        swap: { fromAsset: "USDG", toAsset: "AAPLx", amountType: "FIXED", amountValue: 10 },
      },
    ],
  },
  {
    id: "sys_2",
    name: "Portfolio drawdown guard",
    status: "PAUSED",
    maxAllocation: 100,
    maxAllocationAsset: "USDG",
    executionLimit: 1,
    expiresAt: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    steps: [
      {
        id: "step_2",
        label: "Convert everything to USDG on -50% portfolio",
        conditions: [{ type: "PRICE_PERCENT", params: { asset: "PORTFOLIO", direction: "DOWN", percent: 50 } }],
        swap: { fromAsset: "AAPLx", toAsset: "USDG", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
      },
    ],
  },
  {
    id: "sys_3",
    name: "CPI risk-off",
    status: "AUTHORIZATION_REQUIRED",
    maxAllocation: 40,
    maxAllocationAsset: "USDG",
    executionLimit: 1,
    expiresAt: null,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    hasWarning: true,
    steps: [
      {
        id: "step_3",
        label: "Convert NVDAx to USDG if High Impact News within 2 hours",
        conditions: [{ type: "HIGH_IMPACT_NEWS", params: { withinHours: 1 } }],
        swap: { fromAsset: "NVDAx", toAsset: "USDG", amountType: "CURRENT_BALANCE_PERCENT", amountValue: 100 },
      },
    ],
  },
];

export const mockExecutions: Record<string, ExecutionLogEntry[]> = {
  sys_1: [
    {
      id: "exec_1",
      systemId: "sys_1",
      runId: "run_1",
      stepId: "step_1",
      stepLabel: "Buy $10 of AAPLx on -5%",
      status: "SUCCESS",
      attemptCount: 1,
      txHash: "0x71a9…c4e2",
      errorMessage: null,
      executedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    },
    {
      id: "exec_2",
      systemId: "sys_1",
      runId: "run_2",
      stepId: "step_1",
      stepLabel: "Buy $10 of AAPLx on -5%",
      status: "FAILED",
      attemptCount: 2,
      txHash: null,
      errorMessage: "Slippage exceeded configured maximum (1%).",
      executedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    },
  ],
  sys_2: [],
  sys_3: [],
};

export const mockPositions: Position[] = [
  {
    id: "pos_1",
    systemId: "sys_1",
    systemName: "AAPLx dip buyer",
    assetSymbol: "AAPLx",
    assetName: "Apple",
    quantity: 0.051,
    avgCostUsd: 195.2,
    currentPriceUsd: 196.4,
    roiPercent: 0.61,
    status: "OPEN",
    openedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
    closedAt: null,
  },
];

export const mockActivity: ActivityItem[] = [
  {
    id: "act_1",
    kind: "SYSTEM_EXECUTION",
    systemName: "AAPLx dip buyer",
    assetSymbol: "AAPLx",
    side: "BUY",
    amountUsd: 10,
    status: "SUCCESS",
    txHash: "0x71a9…c4e2",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "act_2",
    kind: "SYSTEM_EXECUTION",
    systemName: "AAPLx dip buyer",
    assetSymbol: "AAPLx",
    side: "BUY",
    amountUsd: 10,
    status: "FAILED",
    txHash: null,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "act_3",
    kind: "ONE_OFF",
    systemName: null,
    assetSymbol: "GLDx",
    side: "BUY",
    amountUsd: 25,
    status: "SUCCESS",
    txHash: "0x22f0…9b31",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 52).toISOString(),
  },
];

export const mockSettings: SettingsResponse = {
  memoryEnabled: true,
  memorySummary:
    "Prefers gradual accumulation over lump-sum buys. Comfortable with moderate risk. Primarily interested in AAPLx and GLDx exposure.",
  timezone: "America/New_York",
  maxSlippagePercent: 1,
};

export const mockChats: ChatThread[] = [
  {
    id: "chat_1",
    title: "AAPLx dip buyer setup",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Set a system that buys $10 worth of AAPLx every time it drops 5%, until I own $50 worth.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      },
      {
        id: "m2",
        role: "assistant",
        content:
          "Here's the UPM I'll create. It buys $10 of AAPLx each time price drops 5% from the last execution, up to $50 total allocation.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5 + 2000).toISOString(),
        pendingSystem: {
          draftSystemId: "draft_1",
          name: "AAPLx dip buyer",
          summary: "Buy $10 of AAPLx on -5% price moves, up to $50 total.",
          maxAllocation: 50,
          maxAllocationAsset: "USDG",
          status: "ACTIVATED",
        },
      },
    ],
  },
];

let chatIdCounter = mockChats.length + 1;
let msgIdCounter = 3;

export function nextChatId() {
  return `chat_${chatIdCounter++}`;
}
export function nextMsgId() {
  return `m${msgIdCounter++}`;
}
