import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Database } from "@oplier/db";
import { assetPriceHistory, assetPrices } from "@oplier/db";
import type { LatestPriceRow, PriceRepository, PricePoint } from "@oplier/data-layer";

/**
 * Real Drizzle-backed `PriceRepository`. `@oplier/data-layer` ships this as a commented-out sketch
 * excluded from its typecheck; this is the compiled implementation against Part B's real
 * `prices.ts` schema (`asset_prices` latest-value cache + `asset_price_history` append-only log,
 * exactly the two-path split doc 05 §5 requires).
 *
 * ⚠ NOT YET RUN AGAINST A LIVE DATABASE.
 *
 * Note on `numeric` columns: `price` is `numeric(38,18)`, which Drizzle returns as a string, while
 * the data-layer's interface uses `number`. Conversion happens here rather than being pushed into
 * the adapter, because prices are genuinely used as numbers for comparison math (unlike money
 * amounts, which stay strings end-to-end). 18 decimal places of a price is comfortably inside
 * double precision for any realistic asset price, so this is safe — but it is a deliberate
 * narrowing, not an oversight.
 */
export class DrizzlePriceRepository implements PriceRepository {
  constructor(private readonly db: Database) {}

  async getLatestPrice(assetId: string): Promise<LatestPriceRow | null> {
    const [row] = await this.db.select().from(assetPrices).where(eq(assetPrices.assetId, assetId)).limit(1);
    if (!row) return null;
    return {
      assetId: row.assetId,
      price: Number(row.price),
      source: "pyth",
      observedAt: row.observedAt,
      isStale: row.isStale,
      updatedAt: row.updatedAt,
    };
  }

  async upsertLatestPrice(row: LatestPriceRow): Promise<void> {
    await this.db
      .insert(assetPrices)
      .values({
        assetId: row.assetId,
        price: String(row.price),
        source: row.source,
        observedAt: row.observedAt,
        isStale: row.isStale,
        updatedAt: row.updatedAt,
      })
      .onConflictDoUpdate({
        target: assetPrices.assetId,
        set: {
          price: String(row.price),
          source: row.source,
          observedAt: row.observedAt,
          isStale: row.isStale,
          updatedAt: row.updatedAt,
        },
      });
  }

  async appendHistory(point: PricePoint): Promise<void> {
    await this.db.insert(assetPriceHistory).values({
      assetId: point.assetId,
      price: String(point.price),
      source: point.source,
      observedAt: point.observedAt,
    });
  }

  async getHistory(assetId: string, range: { from: Date; to: Date }): Promise<PricePoint[]> {
    const rows = await this.db
      .select()
      .from(assetPriceHistory)
      .where(
        and(
          eq(assetPriceHistory.assetId, assetId),
          gte(assetPriceHistory.observedAt, range.from),
          lte(assetPriceHistory.observedAt, range.to),
        ),
      )
      .orderBy(asc(assetPriceHistory.observedAt));
    return rows.map((r) => ({
      assetId: r.assetId,
      price: Number(r.price),
      observedAt: r.observedAt,
      source: "pyth" as const,
    }));
  }
}
