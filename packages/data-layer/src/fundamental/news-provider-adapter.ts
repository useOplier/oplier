// =============================================================================
// src/fundamental/news-provider-adapter.ts
//
// Implements the engine-exact `NewsDataProvider` (types.ts, reproduced from
// ENGINE_CONTRACT.md §1). Per that contract's own note: "the real adapter is
// probably a thin repository-backed implementation living wherever Part B/J
// agree" — this IS that thin adapter, living in Part J since Part J owns
// `high_impact_news_events`.
// =============================================================================

import type { NewsDataProvider } from "../types.js";
import type { NewsRepository } from "../repository/types.js";

export class HinNewsDataProviderAdapter implements NewsDataProvider {
  constructor(private readonly newsRepository: NewsRepository) {}

  async hasUpcomingHighImpactEvent(withinHours: 1 | 24): Promise<boolean> {
    const upcoming = await this.newsRepository.getUpcoming(withinHours);
    // doc 01 §10's example condition is "HIGH IMPACT + within N hours" — only
    // HIGH-tier events should trip this, not MEDIUM/LOW rows that also
    // happen to be in the news repository. MEDIUM/LOW rows exist in the same
    // table (doc 01 §10's structured fields include `impact_level` as a
    // spectrum, not a boolean) so they're stored, just not what this
    // boolean condition reports on.
    return upcoming.some((e) => e.impactLevel === "HIGH");
  }
}
