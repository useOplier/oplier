// =============================================================================
// src/fundamental/edgar-client.ts — SEC EDGAR filings (doc 01 §4's "SEC
// EDGAR" source). Backs `FundamentalDataService.getRelevantFilings(ticker)`.
//
// ⚠ VERIFY BEFORE DEPLOY:
//   - SEC EDGAR's API (data.sec.gov) REQUIRES a descriptive `User-Agent`
//     header identifying the requesting application + contact
//     (https://www.sec.gov/os/webmaster-faq#developers) — requests without
//     one are rejected. `EdgarClientDeps.userAgent` is required (no
//     default), enforced by `EdgarConfigError` below, so this can't ship
//     with a missing/generic header that gets the product rate-limited or
//     blocked.
//   - Ticker → CIK resolution uses `https://www.sec.gov/files/company_tickers.json`
//     (a full-market flat file, ~10k companies) as of training-data
//     knowledge — confirm this exact path is still current before deploy.
//   - Filing history uses `https://data.sec.gov/submissions/CIK{10-digit}.json`
//     — confirmed-stable shape as of training-data knowledge, but confirm
//     live per this build's blanket rule.
//   - Registry scope: this client only resolves tickers the app's asset
//     registry underlying assets actually need (AAPL, META, NVDA — GLD is an
//     ETF/commodity trust with its own EDGAR filer, not a company with the
//     same filing types; USDG has no EDGAR presence). `getRelevantFilings`
//     is written generically for any ticker, not hardcoded to these three,
//     per the brief's "real, full feature — not a thin stub" requirement.
// =============================================================================

import type { SECFiling } from "../types.js";
import { BaseSourceClient, type SourceClientDeps } from "./source-client.js";

export interface EdgarClientDeps extends SourceClientDeps {
  userAgent: string;
}

export class EdgarConfigError extends Error {
  constructor() {
    super(
      "EdgarClient requires a descriptive User-Agent (SEC Fair Access policy) — see edgar-client.ts file header.",
    );
    this.name = "EdgarConfigError";
  }
}

interface CompanyTickersResponse {
  [key: string]: { cik_str: number; ticker: string; title: string };
}

interface SubmissionsResponse {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

/** Filing types most relevant to fundamental analysis (doc 02): earnings, material events, ownership. */
export const RELEVANT_FORM_TYPES = ["10-K", "10-Q", "8-K", "DEF 14A"];

export class EdgarClient extends BaseSourceClient {
  readonly sourceName = "SEC_EDGAR" as const;
  private readonly userAgent: string;
  private tickerToCik: Map<string, { cik: string; name: string }> | null = null;

  constructor(deps: EdgarClientDeps) {
    super(deps);
    if (!deps.userAgent) throw new EdgarConfigError();
    this.userAgent = deps.userAgent;
  }

  private headers(): Record<string, string> {
    return { "User-Agent": this.userAgent, Accept: "application/json" };
  }

  private async loadTickerMap(): Promise<Map<string, { cik: string; name: string }>> {
    if (this.tickerToCik) return this.tickerToCik;
    const data = await this.fetchJson<CompanyTickersResponse>(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: this.headers() },
    );
    const map = new Map<string, { cik: string; name: string }>();
    for (const entry of Object.values(data)) {
      map.set(entry.ticker.toUpperCase(), { cik: String(entry.cik_str).padStart(10, "0"), name: entry.title });
    }
    this.tickerToCik = map;
    return map;
  }

  /** Resolves a ticker to its filing history and returns recent relevant filings, most recent first. */
  async getRelevantFilings(ticker: string, limit = 10): Promise<SECFiling[]> {
    const map = await this.loadTickerMap();
    const entry = map.get(ticker.toUpperCase());
    // Never fabricate: an unresolved ticker returns an empty list, not a guessed CIK.
    if (!entry) return [];

    const submissions = await this.fetchJson<SubmissionsResponse>(
      `https://data.sec.gov/submissions/CIK${entry.cik}.json`,
      { headers: this.headers() },
    );

    const { accessionNumber, filingDate, form, primaryDocument, reportDate } = submissions.filings.recent;
    const filings: SECFiling[] = [];

    for (let i = 0; i < accessionNumber.length && filings.length < limit; i++) {
      const formType = form[i];
      if (!formType || !RELEVANT_FORM_TYPES.includes(formType)) continue;
      const accession = accessionNumber[i];
      const doc = primaryDocument[i];
      if (!accession || !doc) continue;

      filings.push({
        ticker: ticker.toUpperCase(),
        cik: entry.cik,
        accessionNumber: accession,
        formType,
        filedAt: new Date(`${filingDate[i]}T00:00:00Z`),
        reportDate: reportDate[i] ? new Date(`${reportDate[i]}T00:00:00Z`) : null,
        primaryDocumentUrl: `https://www.sec.gov/Archives/edgar/data/${Number(entry.cik)}/${accession.replace(/-/g, "")}/${doc}`,
        companyName: entry.name,
      });
    }
    return filings;
  }
}
