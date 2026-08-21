/**
 * packages/llm/src/services/tavily-client.ts
 *
 * search_web is the one LLM #1 tool that is NOT a Part B endpoint (doc 03: "Tavily is the
 * product's web search provider for controlled web retrieval"). Kept as its own injected
 * dependency, separate from ApiClient, so conversation.service.ts's "only one side-effect
 * surface for backend calls" invariant stays meaningful — Tavily is explicitly the one
 * documented exception, not a second unreviewed side-effect surface.
 */

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface TavilyClient {
  search(query: string): Promise<TavilySearchResult[]>;
}

export class RealTavilyClient implements TavilyClient {
  constructor(private readonly apiKey: string) {}

  async search(query: string): Promise<TavilySearchResult[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: 5 }),
    });
    if (!res.ok) {
      throw new Error(`Tavily search failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as any;
    return (data.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      publishedDate: r.published_date,
    }));
  }
}
