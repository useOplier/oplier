import type { PriceDataProvider, PriceSnapshot } from "../types.js";

/**
 * Scriptable price mock. Mirrors the doc 01 §11 testnet demo pattern ("mock AAPL $200 →
 * $190 triggers"): tests call `.set(assetId, price)` to move a price, then run an
 * evaluation cycle and assert on the resulting state transition.
 */
export class MockPriceDataProvider implements PriceDataProvider {
  private prices = new Map<string, { price: number; isStale: boolean }>();

  set(assetId: string, price: number, opts?: { isStale?: boolean }): void {
    this.prices.set(assetId, { price, isStale: opts?.isStale ?? false });
  }

  setStale(assetId: string, isStale: boolean): void {
    const existing = this.prices.get(assetId);
    if (existing) existing.isStale = isStale;
  }

  async getCurrentPrice(assetId: string): Promise<PriceSnapshot> {
    const entry = this.prices.get(assetId);
    if (!entry) throw new Error(`MockPriceDataProvider: no price seeded for asset "${assetId}"`);
    return { price: entry.price, timestamp: Date.now(), isStale: entry.isStale };
  }
}
