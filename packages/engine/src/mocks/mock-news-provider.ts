import type { NewsDataProvider } from "../types.js";

export class MockNewsDataProvider implements NewsDataProvider {
  private upcoming = { within1h: false, within24h: false };

  setUpcoming(within1h: boolean, within24h: boolean): void {
    this.upcoming = { within1h, within24h };
  }

  async hasUpcomingHighImpactEvent(withinHours: 1 | 24): Promise<boolean> {
    return withinHours === 1 ? this.upcoming.within1h : this.upcoming.within24h;
  }
}
