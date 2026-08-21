/**
 * packages/llm/src/services/api-client.ts
 *
 * The ONE side-effect surface conversation.service.ts is allowed to call (see that file's header
 * comment). This is intentionally a thin interface, not a class with real HTTP logic baked in —
 * `apps/api` (or wherever Part G's service functions actually run) provides the real
 * implementation, backed by Part B's endpoints, with the user's accessToken already attached.
 * Part G owns the interface + the tool-name -> endpoint mapping (this file); Part B owns what's
 * behind each endpoint.
 *
 * Every branch below cites its API_CONTRACT.md endpoint. Two are explicitly marked UNCONFIRMED —
 * see tool-definitions.ts's block comments on prepare_transaction / get_fundamental_data for the
 * full flag. Do not treat ReferenceApiClient below as production code; it's a documented mapping
 * + a fetch-based reference implementation for apps/api to adapt, not a finished service.
 *
 * NOTE: `search_web` is intentionally NOT routed here — it's not a Part B endpoint. See
 * tavily-client.ts and conversation.service.ts's dispatch logic.
 */

export interface ApiError {
  code:
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "VALIDATION_ERROR"
    | "UNSUPPORTED_CAPABILITY"
    | "UNSUPPORTED_ASSET"
    | "CONFLICT"
    | "RATE_LIMITED"
    | "INTERNAL_ERROR";
  message: string;
  details?: unknown;
}

export interface ApiClient {
  /** Executes the named LLM tool against the real backend. Throws an object matching ApiError's
   * shape (code/message/details) on any non-2xx response — never returns a synthesized success. */
  callTool(toolName: string, input: unknown): Promise<unknown>;
}

/** Reference implementation — a real backend integration should mirror this mapping exactly
 * against Part B's actual HTTP client, not reinvent it. Kept intentionally dependency-free
 * (raw fetch) so it's copy-adaptable regardless of what HTTP client apps/api ends up using. */
export class ReferenceApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  async callTool(toolName: string, input: unknown): Promise<unknown> {
    const req = this.route(toolName, input);
    const res = await fetch(`${this.baseUrl}${req.path}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...(req.body ? { "Content-Type": "application/json" } : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as any;
      throw (body?.error as ApiError) ?? { code: "INTERNAL_ERROR", message: `HTTP ${res.status}` };
    }
    if (res.status === 204) return {};
    return res.json();
  }

  private route(toolName: string, input: any): { method: string; path: string; body?: unknown } {
    switch (toolName) {
      case "get_portfolio":
        return { method: "GET", path: "/portfolio" };
      case "get_positions":
        return { method: "GET", path: "/positions" };
      case "get_systems":
        return { method: "GET", path: "/systems" };
      case "get_system":
        return { method: "GET", path: `/systems/${encodeURIComponent(input.systemId)}` };
      case "get_settings":
        return { method: "GET", path: "/settings" };
      case "get_high_impact_news":
        return { method: "GET", path: "/high-impact-news" };
      case "approve_transaction":
        return {
          method: "POST",
          path: `/transactions/${encodeURIComponent(input.transactionId)}/approve`,
        };
      case "create_system":
        // Deliberately /systems/validate, not POST /systems — see createSystemTool's description
        // for the design decision this encodes (validate-only preview; user activates via UI).
        return { method: "POST", path: "/systems/validate", body: input.spec };
      case "modify_system":
        return { method: "PATCH", path: `/systems/${encodeURIComponent(input.systemId)}`, body: input.changes };
      case "pause_system":
        return { method: "POST", path: `/systems/${encodeURIComponent(input.systemId)}/pause` };
      case "resume_system":
        return { method: "POST", path: `/systems/${encodeURIComponent(input.systemId)}/resume` };
      case "delete_system":
        return { method: "DELETE", path: `/systems/${encodeURIComponent(input.systemId)}` };
      case "reactivate_system":
        return { method: "POST", path: `/systems/${encodeURIComponent(input.systemId)}/reactivate` };
      case "prepare_transaction":
        // UNCONFIRMED endpoint — see tool-definitions.ts. Placeholder path, flagged, not silently
        // treated as real.
        return { method: "POST", path: "/transactions/prepare", body: input };
      case "get_fundamental_data":
        throw {
          code: "UNSUPPORTED_CAPABILITY",
          message: "get_fundamental_data has no backend implementation yet (pending Part J).",
        } satisfies ApiError;
      default:
        throw new Error(`ReferenceApiClient: unknown tool "${toolName}"`);
    }
  }
}
