/**
 * Mirrors `packages/shared-types` as described in API_CONTRACT.md §8. That
 * package's real Zod schemas are the actual source of truth once Part B's
 * repo is available to install — these hand-written types exist so Part H
 * can build and typecheck independently in the meantime. Field names follow
 * API_CONTRACT.md §6 exactly (e.g. `amount_type` enum values, condition
 * param shapes) rather than doc 04's looser prose framing.
 */

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_CAPABILITY"
  | "UNSUPPORTED_ASSET"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  code: ApiErrorCode;
  details?: Record<string, unknown>;
  constructor(body: ApiErrorBody["error"]) {
    super(body.message);
    this.code = body.code;
    this.details = body.details;
  }
}

// ---- Auth -------------------------------------------------------------

export interface NonceResponse {
  nonce: string;
  domain: string;
  uri: string;
  expiresInSeconds: number;
}

export interface VerifyResponse {
  walletAddress: string;
  accessToken: string;
  expiresInSeconds: number;
}

// ---- Portfolio / Home ---------------------------------------------------

export interface HoldingEntry {
  assetSymbol: string;
  assetName: string;
  quantity: number;
  priceUsd: number;
  valueUsd: number;
  roiPercent: number | null;
}

export interface PortfolioResponse {
  totalValueUsd: number;
  // RWA *and* registered stablecoins — the backend's product decision (2026-08-21)
  // explicitly overrides doc 06 §2's "RWA assets only", since a portfolio showing
  // $0 while the wallet holds tUSDG reads as broken.
  holdings: HoldingEntry[];
}

// ---- High Impact News ---------------------------------------------------

export interface HighImpactNewsEvent {
  id: string;
  event: string;
  eventTimestamp: string; // ISO
  country: string;
  eventType: string;
  impactLevel: "HIGH";
}

// ---- AI Insight (doc 01 §3, surfaced on Home) ---------------------------

export interface AiInsight {
  id: string;
  headline: string; // e.g. "US CPI tomorrow — High impact"
  body: string;
  relatedNewsId: string | null;
}

// ---- Systems (UPMs) -------------------------------------------------------

export type SystemStatus =
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETE"
  | "EXPIRED"
  | "AUTHORIZATION_REQUIRED"
  // Set by the engine when a step fails unrecoverably (packages/engine step-executor). Was missing
  // here and from both status maps, so rendering a halted System threw on `statusBadge[status].tone`.
  | "HALTED";

export type ConditionSpec =
  | { type: "PRICE_VALUE"; params: { asset: string; operator: "EQ" | "GT" | "LT"; value: number } }
  | { type: "PRICE_PERCENT" | "ROI"; params: { asset: string; direction: "UP" | "DOWN"; percent: number } }
  | { type: "TIME"; params: { date: string | null; time: string | null } }
  | { type: "HIGH_IMPACT_NEWS"; params: { withinHours: 1 | 24 } };

export type AmountType = "FIXED" | "CURRENT_BALANCE_PERCENT" | "SYSTEM_START_BALANCE_PERCENT";

export interface SwapSpec {
  fromAsset: string;
  toAsset: string;
  amountType: AmountType;
  amountValue: number;
}

export interface SystemStepSpec {
  id: string;
  label: string;
  conditions: ConditionSpec[];
  swap: SwapSpec;
}

export interface SystemSpec {
  id: string;
  name: string;
  status: SystemStatus;
  maxAllocation: number;
  maxAllocationAsset: string;
  executionLimit: number;
  expiresAt: string | null;
  steps: SystemStepSpec[];
  createdAt: string;
  hasWarning?: boolean; // backend-detected conflict at creation (doc 02 "System conflicts")
}

export type ExecutionStatus = "SUCCESS" | "FAILED" | "PENDING";

export interface ExecutionLogEntry {
  id: string;
  systemId: string | null;
  runId: string | null;
  stepId: string | null;
  stepLabel: string;
  status: ExecutionStatus;
  attemptCount: number;
  txHash: string | null;
  errorMessage: string | null;
  executedAt: string;
}

export interface SystemDetail extends SystemSpec {
  executions: ExecutionLogEntry[];
}

// ---- Positions ------------------------------------------------------------

export type PositionStatus = "OPEN" | "CLOSED";

export interface Position {
  id: string;
  systemId: string | null;
  systemName: string | null;
  assetSymbol: string;
  assetName: string;
  quantity: number;
  avgCostUsd: number;
  currentPriceUsd: number;
  roiPercent: number;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
}

// ---- Activity ---------------------------------------------------------

export type ActivityKind = "SYSTEM_EXECUTION" | "ONE_OFF";
export type ActivitySide = "BUY" | "SELL";
export type TransactionStatus = "SUCCESS" | "FAILED" | "PENDING";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  systemName: string | null;
  assetSymbol: string;
  side: ActivitySide;
  amountUsd: number;
  status: TransactionStatus;
  txHash: string | null;
  timestamp: string;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

// ---- Settings ------------------------------------------------------------

export interface SettingsResponse {
  memoryEnabled: boolean;
  memorySummary: string;
  timezone: string;
  maxSlippagePercent: number; // default 1
}

// ---- One-off transactions (doc 02 "One-off transactions") ----------------

export interface TransactionPrepareRequest {
  fromAsset: string;
  toAsset: string;
  amountAsset: string;
  amount: number;
}

export interface TransactionPrepareResponse {
  id: string;
  fromAsset: string;
  toAsset: string;
  amount: number;
  amountAsset: string;
  estimatedReceiveAmount: number;
  estimatedPriceUsd: number;
  maxSlippagePercent: number;
  expiresAt: string;
}
