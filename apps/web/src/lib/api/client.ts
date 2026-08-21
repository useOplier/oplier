import { useAuthStore } from "@/store/useAuthStore";
import {
  mockActivity,
  mockChats,
  mockExecutions,
  mockHoldings,
  mockInsights,
  mockNews,
  mockPositions,
  mockSettings,
  mockSystems,
  nextChatId,
  nextMsgId,
} from "./mock-db";
import type {
  ActivityPage,
  AiInsight,
  ExecutionLogEntry,
  HighImpactNewsEvent,
  NonceResponse,
  PortfolioResponse,
  Position,
  SettingsResponse,
  SystemDetail,
  SystemSpec,
  SystemStatus,
  TransactionPrepareRequest,
  TransactionPrepareResponse,
  VerifyResponse,
} from "./types";
import { ApiError } from "./types";
import type { ChatMessage, ChatSummary, ChatThread, PendingTransactionCard } from "@/lib/llm/types";

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_API !== "false";
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

/** Simulated network latency so loading states are visibly exercised in the mock. */
function wait(ms = 420) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function realFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  /**
   * `Content-Type: application/json` is sent ONLY when there is actually a body.
   *
   * THE BUG THIS FIXES: it used to be set unconditionally, so bodyless requests still declared a JSON
   * payload. Fastify rejects that combination outright — `POST /chats` (no body by design) came back
   * `400 Bad Request: "Body cannot be empty when content-type is set to 'application/json'"`, which
   * made the "new chat" button do nothing at all. Same trap for any other bodyless POST/DELETE.
   *
   * An explicit `Content-Type` passed in `init.headers` still wins, since that spread comes last.
   */
  const hasBody = init?.body !== undefined && init.body !== null;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok) throw new ApiError(body.error);
  return body as T;
}

/**
 * Part B's list endpoints return `{ items: [...] }`, not a bare array
 * (confirmed against the real backend for `/systems`; treated as the
 * project-wide convention here rather than a one-off, since nothing in
 * API_CONTRACT.md documents the wrapper either way). Every list-returning
 * fetch goes through this so there's exactly one place that assumption
 * lives — if a future endpoint turns out to return a bare array instead,
 * this is also the only place that needs to change.
 */
function unwrapItems<T>(body: T[] | { items: T[] }): T[] {
  return Array.isArray(body) ? body : body.items;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function requestNonce(walletAddress: string): Promise<NonceResponse> {
  if (USE_MOCK) {
    await wait(200);
    return {
      nonce: Math.random().toString(36).slice(2),
      domain: typeof window !== "undefined" ? window.location.host : "localhost",
      uri: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      expiresInSeconds: 300,
    };
  }
  return realFetch("/auth/nonce", { method: "POST", body: JSON.stringify({ walletAddress }) });
}

export async function verifySiwe(message: string, signature: string): Promise<VerifyResponse> {
  if (USE_MOCK) {
    await wait(300);
    return { walletAddress: "0xMockWallet", accessToken: "mock-token", expiresInSeconds: 900 };
  }
  return realFetch("/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) });
}

// ---------------------------------------------------------------------------
// Portfolio / Home
// ---------------------------------------------------------------------------

/**
 * Wire shape of GET /portfolio as the backend actually sends it (see
 * `portfolioResponseSchema` in packages/shared-types): each holding carries a
 * nested `asset` registry entry plus string-encoded decimals, and there is no
 * per-holding ROI or unit price.
 */
interface BackendPortfolioHolding {
  asset: { symbol: string; name: string };
  quantity: string;
  costBasis: string;
  currentValue: string;
}

interface BackendPortfolioResponse {
  holdings: BackendPortfolioHolding[];
  totalValue: string;
  cashBalance?: string;
}

/**
 * SHAPE ADAPTER — maps the backend's /portfolio response onto the UI's flat
 * `HoldingEntry` rows.
 *
 * THE BUG THIS FIXES: the raw backend body used to be returned as-is, so every
 * holding reached Home full of `undefined`s (`h.roiPercent`, `h.priceUsd`, …).
 * `h.roiPercent !== null` is true for `undefined`, so `formatPercent(undefined)`
 * ran and crashed the whole page with "Cannot read properties of undefined
 * (reading 'toFixed')" immediately after sign-in.
 */
function adaptPortfolioResponse(body: BackendPortfolioResponse): PortfolioResponse {
  return {
    totalValueUsd: Number(body.totalValue),
    holdings: body.holdings.map((h) => {
      const quantity = Number(h.quantity);
      const valueUsd = Number(h.currentValue);
      return {
        assetSymbol: h.asset.symbol,
        assetName: h.asset.name,
        quantity,
        // The API reports value but not unit price; derive price = value / quantity.
        // Zero-quantity rows are dropped server-side (dust threshold), guarded anyway.
        priceUsd: quantity > 0 ? valueUsd / quantity : 0,
        valueUsd,
        // Cost basis is unknowable from a chain balance (the route always reports "0"),
        // so ROI is genuinely null here rather than fabricated — Home hides the ROI
        // line when it is null.
        roiPercent: null,
      };
    }),
  };
}

export async function getPortfolio(): Promise<PortfolioResponse> {
  if (USE_MOCK) {
    await wait();
    const totalValueUsd = mockHoldings.reduce((sum, h) => sum + h.valueUsd, 0);
    return {
      totalValueUsd,
      holdings: mockHoldings,
    };
  }
  return adaptPortfolioResponse(await realFetch<BackendPortfolioResponse>("/portfolio"));
}

/**
 * FLAGGED, NOT SILENTLY INVENTED: `/insights` isn't in API_CONTRACT.md and
 * is confirmed 404ing against the real backend, not just unimplemented on
 * paper. This needs an explicit answer from Part B, either "here's the real
 * route" or "doc 01 §3's AI Insight is served some other way (e.g. folded
 * into `/portfolio` or into chat)" so Home stops calling a route that
 * doesn't exist. Until then this fails soft (empty list, not a thrown
 * error) so a 404 here doesn't take out the rest of Home.
 */
export async function getInsights(): Promise<AiInsight[]> {
  if (USE_MOCK) {
    await wait(250);
    return mockInsights;
  }
  try {
    const body = await realFetch<AiInsight[] | { items: AiInsight[] }>("/insights");
    return unwrapItems(body);
  } catch {
    return [];
  }
}

export async function getHighImpactNews(): Promise<HighImpactNewsEvent[]> {
  if (USE_MOCK) {
    await wait(250);
    return mockNews;
  }
  const body = await realFetch<HighImpactNewsEvent[] | { items: HighImpactNewsEvent[] }>(
    "/high-impact-news"
  );
  return unwrapItems(body);
}

// ---------------------------------------------------------------------------
// Systems (UPMs)
// ---------------------------------------------------------------------------

export async function listSystems(): Promise<SystemSpec[]> {
  if (USE_MOCK) {
    await wait();
    return mockSystems;
  }
  const body = await realFetch<SystemSpec[] | { items: SystemSpec[] }>("/systems");
  return unwrapItems(body);
}

export async function getSystem(id: string): Promise<SystemDetail> {
  if (USE_MOCK) {
    await wait();
    const sys = mockSystems.find((s) => s.id === id);
    if (!sys) throw new ApiError({ code: "NOT_FOUND", message: "System not found" });
    return { ...sys, executions: mockExecutions[id] ?? [] };
  }
  return realFetch(`/systems/${id}`);
}

function setSystemStatus(id: string, status: SystemStatus) {
  const sys = mockSystems.find((s) => s.id === id);
  if (sys) sys.status = status;
}

export async function pauseSystem(id: string): Promise<void> {
  if (USE_MOCK) {
    await wait(300);
    const sys = mockSystems.find((s) => s.id === id);
    if (sys && sys.status !== "ACTIVE") throw new ApiError({ code: "CONFLICT", message: "System is not active" });
    setSystemStatus(id, "PAUSED");
    return;
  }
  await realFetch(`/systems/${id}/pause`, { method: "POST" });
}

export async function resumeSystem(id: string): Promise<void> {
  if (USE_MOCK) {
    await wait(300);
    const sys = mockSystems.find((s) => s.id === id);
    if (sys && sys.status !== "PAUSED") throw new ApiError({ code: "CONFLICT", message: "System is not paused" });
    setSystemStatus(id, "ACTIVE");
    return;
  }
  await realFetch(`/systems/${id}/resume`, { method: "POST" });
}

export async function deleteSystem(id: string): Promise<void> {
  if (USE_MOCK) {
    await wait(300);
    const idx = mockSystems.findIndex((s) => s.id === id);
    if (idx >= 0) mockSystems.splice(idx, 1);
    return;
  }
  await realFetch(`/systems/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export async function listPositions(): Promise<Position[]> {
  if (USE_MOCK) {
    await wait();
    return mockPositions;
  }
  const body = await realFetch<Position[] | { items: Position[] }>("/positions");
  return unwrapItems(body);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export async function listActivity(cursor?: string): Promise<ActivityPage> {
  if (USE_MOCK) {
    await wait();
    return { items: mockActivity, nextCursor: null };
  }
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return realFetch(`/activity${qs}`);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<SettingsResponse> {
  if (USE_MOCK) {
    await wait(250);
    return mockSettings;
  }
  return realFetch("/settings");
}

export async function updateSettings(patch: Partial<SettingsResponse>): Promise<SettingsResponse> {
  if (USE_MOCK) {
    await wait(300);
    Object.assign(mockSettings, patch);
    return mockSettings;
  }
  return realFetch("/settings", { method: "PATCH", body: JSON.stringify(patch) });
}

// ---------------------------------------------------------------------------
// One-off transactions (doc 02), placeholder path per LLM_CONTRACT.md §4
// ---------------------------------------------------------------------------

export async function prepareTransaction(
  req: TransactionPrepareRequest
): Promise<TransactionPrepareResponse> {
  if (USE_MOCK) {
    await wait(400);
    return {
      id: `tx_${Math.random().toString(36).slice(2, 8)}`,
      fromAsset: req.fromAsset,
      toAsset: req.toAsset,
      amount: req.amount,
      amountAsset: req.amountAsset,
      estimatedReceiveAmount: req.amount / 196.4,
      estimatedPriceUsd: 196.4,
      maxSlippagePercent: mockSettings.maxSlippagePercent,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  return realFetch("/transactions/prepare", { method: "POST", body: JSON.stringify(req) });
}

// ---------------------------------------------------------------------------
// Chat, FLAGGED ASSUMPTION, see src/lib/llm/types.ts header
// ---------------------------------------------------------------------------

export async function listChats(): Promise<ChatSummary[]> {
  if (USE_MOCK) {
    await wait(250);
    return mockChats.map((c) => ({ id: c.id, title: c.title, updatedAt: new Date().toISOString() }));
  }
  const body = await realFetch<ChatSummary[] | { items: ChatSummary[] }>("/chats");
  return unwrapItems(body);
}

export async function getChat(id: string): Promise<ChatThread> {
  if (USE_MOCK) {
    await wait(250);
    const chat = mockChats.find((c) => c.id === id);
    if (!chat) throw new ApiError({ code: "NOT_FOUND", message: "Chat not found" });
    return chat;
  }
  return realFetch(`/chats/${id}`);
}

export async function createChat(): Promise<ChatThread> {
  if (USE_MOCK) {
    await wait(200);
    const chat: ChatThread = { id: nextChatId(), title: "New chat", messages: [] };
    mockChats.unshift(chat);
    return chat;
  }
  return realFetch("/chats", { method: "POST" });
}

export async function deleteChat(id: string): Promise<void> {
  if (USE_MOCK) {
    await wait(200);
    const idx = mockChats.findIndex((c) => c.id === id);
    if (idx >= 0) mockChats.splice(idx, 1);
    return;
  }
  await realFetch(`/chats/${id}`, { method: "DELETE" });
}

/**
 * Sends a user message and returns the assistant's reply. Mirrors
 * `runConversationTurn`'s output shape (LLM_CONTRACT.md §3) minus
 * `toolTrace`, which the contract explicitly says must never reach the
 * end user.
 */
export async function sendChatMessage(chatId: string, content: string): Promise<ChatMessage> {
  const chat = mockChats.find((c) => c.id === chatId);
  if (USE_MOCK) {
    await wait(900);
    if (chat) {
      chat.messages.push({ id: nextMsgId(), role: "user", content, createdAt: new Date().toISOString() });
      if (chat.title === "New chat") chat.title = content.slice(0, 48);
    }
    const reply = mockAssistantReply(content);
    if (chat) chat.messages.push(reply);
    return reply;
  }
  return realFetch(`/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

/**
 * Approve step of doc 02's one-off transaction flow. Per the doc, clicking
 * Approve is not itself the signature, the caller (ChatWindow) triggers the
 * wagmi wallet-signing flow first, then calls this to report the outcome.
 */
export async function reportTransactionOutcome(
  transactionId: string,
  outcome: "SUCCESS" | "FAILED" | "CANCELLED",
  txHash?: string
): Promise<PendingTransactionCard> {
  await wait(600);
  return {
    transactionId,
    fromAsset: "USDG",
    toAsset: "AAPLx",
    amount: 25,
    amountAsset: "USDG",
    estimatedReceiveAmount: 25 / 196.4,
    estimatedPriceUsd: 196.4,
    maxSlippagePercent: mockSettings.maxSlippagePercent,
    status: outcome === "SUCCESS" ? "SUCCESS" : outcome === "CANCELLED" ? "CANCELLED" : "FAILED",
    txHash: outcome === "SUCCESS" ? txHash ?? "0x9c31…af02" : null,
  };
}

/** Activation step of doc 02's UPM creation lifecycle (steps 6-7). */
export async function activateSystem(draft: {
  draftSystemId: string;
  name: string;
  maxAllocation: number;
  maxAllocationAsset: string;
}): Promise<SystemSpec> {
  await wait(500);
  const newSystem: SystemSpec = {
    id: `sys_${Math.random().toString(36).slice(2, 6)}`,
    name: draft.name === "New UPM" ? `UPM ${mockSystems.length + 1}` : draft.name,
    status: "ACTIVE",
    maxAllocation: draft.maxAllocation,
    maxAllocationAsset: draft.maxAllocationAsset,
    executionLimit: 5,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    steps: [],
  };
  mockSystems.unshift(newSystem);
  return newSystem;
}

function mockAssistantReply(userText: string): ChatMessage {
  const lower = userText.toLowerCase();
  const base = { id: nextMsgId(), role: "assistant" as const, createdAt: new Date().toISOString() };

  if (lower.includes("upm") || (lower.includes("buy") && lower.includes("drop"))) {
    return {
      ...base,
      content:
        "Here's the UPM I can create from that. Review the details below, then activate it when you're ready.",
      pendingSystem: {
        draftSystemId: `draft_${Math.random().toString(36).slice(2, 6)}`,
        name: "New UPM",
        summary: userText,
        maxAllocation: 50,
        maxAllocationAsset: "USDG",
        status: "AWAITING_ACTIVATION",
      },
    };
  }

  if (lower.includes("buy") || lower.includes("sell") || lower.includes("swap")) {
    const pendingTransaction: PendingTransactionCard = {
      transactionId: `tx_${Math.random().toString(36).slice(2, 6)}`,
      fromAsset: "USDG",
      toAsset: "AAPLx",
      amount: 25,
      amountAsset: "USDG",
      estimatedReceiveAmount: 25 / 196.4,
      estimatedPriceUsd: 196.4,
      maxSlippagePercent: mockSettings.maxSlippagePercent,
      status: "AWAITING_APPROVAL",
    };
    return {
      ...base,
      content: "I've prepared this transaction. Approve to sign with your wallet, or cancel.",
      pendingTransaction,
    };
  }

  if (lower.includes("breakfast") || lower.includes("recipe") || lower.includes("joke")) {
    return {
      ...base,
      content:
        "I'm focused on your portfolio and investment activity, so I can't help with that. I'm glad to look at your holdings, upcoming events, or a UPM idea instead.",
    };
  }

  if (lower.includes("cpi") || lower.includes("event") || lower.includes("news") || lower.includes("risk")) {
    return {
      ...base,
      content:
        "US CPI prints tomorrow and is classified High Impact. You hold $824.88 in AAPLx, which has historically moved on inflation surprises: a hotter print tends to pressure growth equities, a cooler one tends to support them. I can't say which way it lands. If you want, I can show you a UPM that reduces exposure ahead of High Impact News.",
    };
  }

  return {
    ...base,
    content:
      "Got it. I can help with portfolio questions, fundamental analysis, creating a UPM, or preparing a transaction. What would you like to do?",
  };
}
