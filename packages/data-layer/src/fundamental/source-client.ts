// =============================================================================
// src/fundamental/source-client.ts — shared plumbing for the four approved
// source clients (BLS, FRED, Fed, SEC EDGAR). Each client takes an injectable
// `fetchFn` (defaults to global `fetch`) so tests never need network access,
// same discipline as `PythStreamClient` in pyth/stream-client.ts.
// =============================================================================

import type { FundamentalEvent } from "../types.js";

export type FetchFn = typeof fetch;

export interface SourceClientDeps {
  fetchFn?: FetchFn;
  /** Injected for deterministic tests; defaults to `() => new Date()`. */
  clock?: () => Date;
}

/**
 * Data-integrity rule shared by all four clients (brief, doc 02/doc 03,
 * locked): never fabricate or fill missing information. A source client that
 * can't parse a field returns `null` for that field rather than guessing —
 * enforced here as a helper so each client doesn't reinvent it.
 */
export function requireOrNull<T>(value: T | undefined | null, isValid: (v: T) => boolean): T | null {
  if (value === undefined || value === null) return null;
  return isValid(value) ? value : null;
}

export abstract class BaseSourceClient {
  protected readonly fetchFn: FetchFn;
  protected readonly clock: () => Date;

  constructor(deps: SourceClientDeps = {}) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.clock = deps.clock ?? (() => new Date());
  }

  protected async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(url, init);
    if (!res.ok) {
      throw new SourceFetchError(this.sourceName, url, res.status, await safeText(res));
    }
    return (await res.json()) as T;
  }

  abstract readonly sourceName: FundamentalEvent["source"];
}

export class SourceFetchError extends Error {
  constructor(
    public readonly source: string,
    public readonly url: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`${source} fetch failed: ${status} for ${url} — ${body.slice(0, 300)}`);
    this.name = "SourceFetchError";
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
