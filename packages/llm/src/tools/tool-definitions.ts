/**
 * packages/llm/src/tools/tool-definitions.ts
 *
 * LLM #1's tools. Every tool below maps to a real Part B endpoint in API_CONTRACT.md — see the
 * inline `// API:` comment on each. Two tools do NOT have a confirmed backend endpoint yet;
 * they are clearly marked UNCONFIRMED and explained in the block comment above them. This is a
 * deliberate flag-back, not a silent invention (brief: "no invented endpoints").
 *
 * Each tool follows doc 03 "Tool definitions": purpose, when-to-use, required args, allowed
 * values, return structure, restrictions — captured via Zod `.describe()` (which lands in the
 * JSON-schema `description` field seen by the model) plus the `description` string here for the
 * top-level tool purpose.
 */

import { z } from "zod";
import type { ToolDefinition } from "../types";

// ---------------------------------------------------------------------------------------------
// Shared sub-schemas — mirror packages/shared-types condition-params.ts (API_CONTRACT.md §6)
// exactly. Do not redefine these ad hoc per tool; import from shared-types in the real monorepo.
// Reproduced here so this package is self-contained for review; when wiring into the real repo,
// replace these three re-exports with `import { ... } from "@oplier/shared-types"`.
// ---------------------------------------------------------------------------------------------

const AssetSymbol = z.string().describe(
  "Asset symbol as it appears in the asset registry for the current environment (e.g. 'AAPLx', 'USDG'). " +
    "Never invent a symbol — only use symbols returned by get_high_impact_news/get_portfolio/get_systems " +
    "results or ones the user has explicitly referenced that you have confirmed exist. The backend " +
    "independently rejects unsupported assets with UNSUPPORTED_ASSET regardless.",
);

const ConditionSpec = z.union([
  z.object({
    conditionType: z.literal("PRICE_VALUE"),
    asset: AssetSymbol,
    operator: z.enum(["EQ", "GT", "LT"]),
    value: z.number().positive(),
  }),
  z.object({
    conditionType: z.literal("PRICE_PERCENT"),
    asset: AssetSymbol,
    direction: z.enum(["UP", "DOWN"]),
    percent: z.number().positive(),
  }),
  z.object({
    conditionType: z.literal("ROI"),
    asset: AssetSymbol,
    direction: z.enum(["UP", "DOWN"]),
    percent: z.number().positive(),
  }),
  z.object({
    conditionType: z.literal("TIME"),
    date: z.string().nullable().describe("YYYY-MM-DD or null"),
    time: z.string().nullable().describe("HH:MM (universal app timezone) or null"),
  }),
  z.object({
    conditionType: z.literal("HIGH_IMPACT_NEWS"),
    withinHours: z.union([z.literal(1), z.literal(24)]),
  }),
]);

const AmountType = z.enum(["FIXED", "CURRENT_BALANCE_PERCENT", "SYSTEM_START_BALANCE_PERCENT"]);

const SwapSpec = z.object({
  sourceAsset: AssetSymbol,
  destinationAsset: AssetSymbol,
  amountType: AmountType,
  amountValue: z.number().positive(),
  executionOrder: z.number().int().nonnegative(),
});

const SystemStepSpec = z.object({
  stepOrder: z.number().int().nonnegative(),
  groupOperator: z.enum(["AND", "OR"]).describe(
    "Flat grouping operator for this step's conditions. No nested groups in MVP.",
  ),
  conditions: z.array(ConditionSpec).min(1),
  swap: SwapSpec,
});

const SystemSpec = z.object({
  name: z.string().describe("Short user-facing name for the System/UPM."),
  maxAllocation: z.number().positive().describe(
    "MANDATORY. Must be explicit user input — never guessed, never inferred, never taken from " +
      "Memory. If the user hasn't stated it, ask; do not call this tool without it.",
  ),
  maxAllocationAsset: AssetSymbol,
  executionLimit: z.number().int().positive().describe(
    "Caps repeated firing/retry attempts of the same step within a run.",
  ),
  expiresAt: z.string().nullable().optional().describe("ISO 8601 datetime, or null/omitted for no expiration."),
  steps: z.array(SystemStepSpec).min(1),
});

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

export const getPortfolioTool: ToolDefinition = {
  name: "get_portfolio",
  description:
    "Fetch the user's current RWA portfolio (Home screen data): holdings, portfolio value. " +
    "Stablecoins are excluded per doc 06 §2. Only OPEN positions are summed. Call this whenever " +
    "you need current holdings/portfolio value to answer a question or ground a recommendation " +
    "— never state a portfolio value from memory or a prior turn.",
  inputSchema: z.object({}), // API: GET /portfolio
};

export const getPositionsTool: ToolDefinition = {
  name: "get_positions",
  description:
    "Fetch the user's positions, both OPEN and CLOSED, including per-position cost basis and " +
    "quantity. Use for ROI questions or when the user asks about a position specifically (not " +
    "just current holdings — use get_portfolio for that).",
  inputSchema: z.object({}), // API: GET /positions
};

export const getSystemsTool: ToolDefinition = {
  name: "get_systems",
  description:
    "List the user's Systems (UPMs) with state. Call this before answering any question that " +
    "references 'my systems', a System by name, or asks what automations are active — never " +
    "answer from a prior turn's snapshot, System state can change between messages.",
  inputSchema: z.object({}), // API: GET /systems
};

export const getSystemTool: ToolDefinition = {
  name: "get_system",
  description:
    "Fetch full config and execution log for one specific System by id, e.g. when the user asks " +
    "'why did my AAPL system fail' — resolve the System by name via get_systems first if you " +
    "only have a name, not an id.",
  inputSchema: z.object({
    systemId: z.string().describe("The System's id, as returned by get_systems."),
  }), // API: GET /systems/:id
};

export const createSystemTool: ToolDefinition = {
  name: "create_system",
  description:
    "Translate a natural-language System/UPM request into a structured spec and submit it for " +
    "backend validation. IMPORTANT — this does NOT create/activate the System. It calls the " +
    "validate-only endpoint (POST /systems/validate) and returns the validated spec for you to " +
    "present to the user; actual creation happens only when the user reviews the shown card and " +
    "activates it through the UI (doc 02 creation lifecycle steps 5-8, which require the wallet " +
    "authorization step this tool cannot perform). Never tell the user the System is active after " +
    "calling this tool — only that it's ready for their review. If validation fails with " +
    "UNSUPPORTED_CAPABILITY or UNSUPPORTED_ASSET, tell the user plainly what isn't supported; do " +
    "not silently substitute a different condition/asset/action. maxAllocation must be explicit " +
    "user input — never guess it or pull it from Memory.",
  inputSchema: z.object({ spec: SystemSpec }), // API: POST /systems/validate
};

export const modifySystemTool: ToolDefinition = {
  name: "modify_system",
  description:
    "Modify an existing System. CURRENT BACKEND LIMITATION (API_CONTRACT.md §3, PATCH " +
    "/systems/:id): this stub only supports top-level field changes — name, maxAllocation, " +
    "maxAllocationAsset, executionLimit, expiresAt. If the user's request changes steps, " +
    "conditions, or the swap itself, do NOT call this tool — tell the user that changing a " +
    "System's logic currently requires deleting and recreating it (the permission-recreation " +
    "flow for structural changes isn't available in this backend yet), then offer to help with " +
    "that instead.",
  inputSchema: z.object({
    systemId: z.string(),
    changes: z
      .object({
        name: z.string().optional(),
        maxAllocation: z.number().positive().optional(),
        maxAllocationAsset: AssetSymbol.optional(),
        executionLimit: z.number().int().positive().optional(),
        expiresAt: z.string().nullable().optional(),
      })
      .describe("Only top-level fields — see restriction above."),
  }), // API: PATCH /systems/:id
};

export const pauseSystemTool: ToolDefinition = {
  name: "pause_system",
  description:
    "Pause an ACTIVE System. Valid only from ACTIVE state (backend returns 409 otherwise — if " +
    "that happens, tell the user the System isn't currently active rather than retrying). " +
    "Pausing preserves permissions and execution state; nothing is lost.",
  inputSchema: z.object({ systemId: z.string() }), // API: POST /systems/:id/pause
};

export const resumeSystemTool: ToolDefinition = {
  name: "resume_system",
  description:
    "Resume a PAUSED System back to ACTIVE. Valid only from PAUSED state (409 otherwise).",
  inputSchema: z.object({ systemId: z.string() }), // API: POST /systems/:id/resume
};

export const deleteSystemTool: ToolDefinition = {
  name: "delete_system",
  description:
    "Permanently delete a System. This revokes its permissions and removes the System " +
    "definition; execution/transaction history survives (orphaned, not deleted). This is " +
    "irreversible — if the user's intent seems uncertain ('should I delete this?'), confirm " +
    "before calling this tool rather than after.",
  inputSchema: z.object({ systemId: z.string() }), // API: DELETE /systems/:id
};

export const reactivateSystemTool: ToolDefinition = {
  name: "reactivate_system",
  description:
    "Reactivate a COMPLETE or EXPIRED System — starts a fresh run from Step 1 with new " +
    "permissions, preserving history. Not valid for other states.",
  inputSchema: z.object({ systemId: z.string() }), // API: POST /systems/:id/reactivate
};

export const getHighImpactNewsTool: ToolDefinition = {
  name: "get_high_impact_news",
  description:
    "Fetch the product's predefined upcoming High Impact News events (eventTimestamp >= now). " +
    "This is the ONLY news/event data System conditions can use. You MUST call this and show the " +
    "user the current list before creating any System with a HIGH_IMPACT_NEWS condition (doc 02). " +
    "Do not use search_web results as a substitute for this list when the purpose is a System " +
    "condition — search_web is for open-ended fundamental-analysis conversation only.",
  inputSchema: z.object({}), // API: GET /high-impact-news
};

export const searchWebTool: ToolDefinition = {
  name: "search_web",
  description:
    "Search the web via Tavily for information not covered by the approved structured sources " +
    "(BLS/FRED/Fed/SEC EDGAR — see get_fundamental_data) or by backend/portfolio tools. Use for " +
    "open-ended fundamental-analysis conversation, not for anything a structured source or a " +
    "backend tool already answers authoritatively (source hierarchy, doc 03: authoritative " +
    "backend data > approved external sources > Tavily/LLM knowledge). Prefer reputable/primary " +
    "sources in results, note publication dates, and do not treat a snippet as a verified fact " +
    "without corroboration for anything load-bearing to a financial claim.",
  inputSchema: z.object({
    query: z.string(),
  }), // External: Tavily API, not a Part B endpoint.
};

/**
 * UNCONFIRMED — flagged back to the manager thread, not silently invented.
 *
 * Doc 02 "One-off transactions" and doc 03 both require LLM #1 to be able to prepare a
 * transaction request that the backend constructs/validates before the Approve/Cancel template
 * is shown in Chat. API_CONTRACT.md's endpoint list (§3, §3.1) has NO route for this — there is
 * no `POST /transactions/...` anywhere in Part B's contract. This is a genuine contract gap, not
 * a normalization issue, so it's flagged rather than papered over.
 *
 * This tool is implemented against a placeholder path so Part G isn't blocked, and its call site
 * in conversation.service.ts is isolated behind the same ApiClient interface as every other tool
 * (see services/conversation.service.ts) so swapping in the real path is a one-line change once
 * Part B confirms it. Suggested shape, for Part B to confirm/replace:
 *   POST /transactions/prepare
 *   Body: { sourceAsset, destinationAsset, amount, amountAsset }
 *   Returns: { transactionId, sourceAsset, destinationAsset, amount, estimatedOutput,
 *              maxSlippageBps, expiresInSeconds }
 * which the frontend then renders as the predefined Approve/Cancel template (doc 02 step 3-4).
 */
export const prepareTransactionTool: ToolDefinition = {
  name: "prepare_transaction",
  description:
    "Prepare a one-off (non-System) transaction for the user to review. Only call this after the " +
    "user has explicitly confirmed they want to proceed — analysis/research alone is never " +
    "sufficient authorization (doc 03 'User decision vs AI decision'). This does not execute " +
    "anything: it returns a prepared transaction (id, quote, expiry) for you to present. You MUST " +
    "include the returned transactionId VERBATIM in your reply when presenting it — the user (and " +
    "approve_transaction) reference that exact id. On the user's explicit approval of THIS " +
    "prepared transaction, call approve_transaction with its id to execute it. Report only what " +
    "the backend actually confirms — never assume success.",
  inputSchema: z.object({
    sourceAsset: AssetSymbol,
    destinationAsset: AssetSymbol,
    // POST /transactions/prepare validates amount as a decimal STRING (shared-types
    // transactions-api-types.ts) — a JSON number here fails zod with a generic validation
    // error (seen live: model sent 1, API wanted "1").
    amount: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'positive decimal string, e.g. "1" or "0.5"')
      .describe("Trade size as a decimal STRING (not a JSON number), denominated in `amountAsset`."),
    amountAsset: AssetSymbol.describe("Which side of the trade `amount` is denominated in."),
  }), // API: UNCONFIRMED — see block comment above. Placeholder: POST /transactions/prepare
};

export const approveTransactionTool: ToolDefinition = {
  name: "approve_transaction",
  description:
    "Execute a previously PREPARED one-off transaction on-chain. Call ONLY when the user has " +
    "explicitly approved the specific prepared transaction you presented (restate its details if " +
    "any ambiguity). Executes synchronously: the response carries the real outcome — SUCCESS with " +
    "a tx hash, or FAILED with a reason. Report exactly that; never claim success without the " +
    "backend confirming it. Prepared transactions expire in ~2 minutes — if approval comes back " +
    "NOT_FOUND, re-prepare instead of retrying.",
  inputSchema: z.object({
    transactionId: z.string().describe("The transactionId returned by prepare_transaction."),
  }), // API: POST /transactions/:id/approve
};

/**
 * UNCONFIRMED — same category of flag as get_fundamental_data below, for a different reason.
 *
 * Doc 01 §4 and this part's own brief require fundamental-analysis tool access to BLS/FRED/Fed
 * data and SEC EDGAR, "coordinate with Part J on the exact tool shape for those sources." Part J
 * owns that ingestion pipeline and no shape has been agreed yet, so this tool is a placeholder
 * only — do not wire it to a real endpoint or ship it enabled until Part J's contract exists.
 * high_impact_news_events (get_high_impact_news, above) is a separate, already-confirmed table/
 * endpoint and is unaffected by this gap.
 */
export const getFundamentalDataTool: ToolDefinition = {
  name: "get_fundamental_data",
  description:
    "PLACEHOLDER — not yet backed by a real endpoint, do not enable in production until Part J's " +
    "tool contract is confirmed. Intended purpose: query approved structured sources (BLS, FRED, " +
    "Federal Reserve, SEC EDGAR) for economic/financial data relevant to the user's holdings.",
  inputSchema: z.object({
    topic: z.string(),
    relatedAssets: z.array(AssetSymbol).optional(),
  }), // API: UNCONFIRMED — pending Part J
};

export const getSettingsTool: ToolDefinition = {
  name: "get_settings",
  description:
    "Fetch the user's settings (timezone, default max slippage, memory enabled). Use when a " +
    "System/transaction discussion needs to reference the user's current timezone or default " +
    "slippage rather than assuming one.",
  inputSchema: z.object({}), // API: GET /settings
};

/** All LLM #1 tools, in the order presented to the model. Order is stable/deliberate: read-only
 * data tools first, then System lifecycle tools, then transaction/research tools — reduces the
 * chance the model reaches for a mutating tool before checking current state. */
export const llm1Tools: ToolDefinition[] = [
  getPortfolioTool,
  getPositionsTool,
  getSystemsTool,
  getSystemTool,
  getSettingsTool,
  getHighImpactNewsTool,
  createSystemTool,
  modifySystemTool,
  pauseSystemTool,
  resumeSystemTool,
  deleteSystemTool,
  reactivateSystemTool,
  prepareTransactionTool,
  approveTransactionTool,
  getFundamentalDataTool,
  searchWebTool,
];
