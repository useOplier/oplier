// =============================================================================
// src/repository/in-memory-repository.ts — fully runnable, used by tests.
// Mirrors the real schema's shape closely enough (single-row-latest cache +
// append-only history for prices; upsert-by-natural-key for news) to exercise
// staleness/carry-forward and HIN-window logic correctly.
// =============================================================================

import type { HINEvent, PricePoint } from "../types.js";
import type { LatestPriceRow, NewsRepository, PriceRepository } from "./types.js";

export class InMemoryPriceRepository implements PriceRepository {
  private latest = new Map<string, LatestPriceRow>();
  private history: PricePoint[] = [];

  async getLatestPrice(assetId: string): Promise<LatestPriceRow | null> {
    return this.latest.get(assetId) ?? null;
  }

  async upsertLatestPrice(row: LatestPriceRow): Promise<void> {
    this.latest.set(row.assetId, row);
  }

  async appendHistory(point: PricePoint): Promise<void> {
    this.history.push(point);
  }

  async getHistory(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]> {
    return this.history
      .filter(
        (p) =>
          p.assetId === assetId &&
          p.observedAt.getTime() >= range.from.getTime() &&
          p.observedAt.getTime() <= range.to.getTime(),
      )
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }

  /** Test helper — not part of the interface. */
  _reset(): void {
    this.latest.clear();
    this.history = [];
  }
}

export class InMemoryNewsRepository implements NewsRepository {
  private events = new Map<string, HINEvent>();

  private naturalKey(e: Pick<HINEvent, "event" | "eventTimestamp" | "country">): string {
    return `${e.event}::${e.eventTimestamp.toISOString()}::${e.country}`;
  }

  async upsertEvents(events: HINEvent[]): Promise<void> {
    for (const e of events) {
      // Upsert-by-natural-key: reuse the existing id if this event was seen before,
      // so re-ingestion doesn't fork identity for the same real-world event.
      const existing = [...this.events.values()].find(
        (ex) => this.naturalKey(ex) === this.naturalKey(e),
      );
      const id = existing?.id ?? e.id;
      this.events.set(id, { ...e, id });
    }
  }

  async getEvents(range?: { from: Date; to: Date }): Promise<HINEvent[]> {
    const all = [...this.events.values()];
    if (!range) return all.sort((a, b) => a.eventTimestamp.getTime() - b.eventTimestamp.getTime());
    return all
      .filter(
        (e) =>
          e.eventTimestamp.getTime() >= range.from.getTime() &&
          e.eventTimestamp.getTime() <= range.to.getTime(),
      )
      .sort((a, b) => a.eventTimestamp.getTime() - b.eventTimestamp.getTime());
  }

  async getEventById(id: string): Promise<HINEvent | null> {
    return this.events.get(id) ?? null;
  }

  async getUpcoming(withinHours: number): Promise<HINEvent[]> {
    const now = Date.now();
    const horizon = now + withinHours * 60 * 60 * 1000;
    return [...this.events.values()]
      .filter((e) => e.eventTimestamp.getTime() >= now && e.eventTimestamp.getTime() <= horizon)
      .sort((a, b) => a.eventTimestamp.getTime() - b.eventTimestamp.getTime());
  }

  /** Test helper — not part of the interface. */
  _reset(): void {
    this.events.clear();
  }
}
