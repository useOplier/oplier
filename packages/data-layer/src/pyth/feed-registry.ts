// =============================================================================
// src/pyth/feed-registry.ts
//
// FEED IDS VERIFIED LIVE — 2026-08-19, against Hermes' /v2/price_feeds listing
// and /v2/updates/price/latest (all four returned a live price on that date).
//
// History, because the previous state of this file was actively misleading: the
// ids here were originally transcribed from model training data in a build chat
// with no network access. Three of them (test_aapl, test_nvda, test_gold) were
// wrong, and the comments claimed test_meta was "deliberately malformed" as a
// canary — it never was. It was the one id that happened to be correct. The
// three wrong ids were 63 hex chars, which the worker's preflight shape check
// caught; had the invented tails been 64 chars they would have passed shape and
// only the Hermes existence check would have caught them. Treat every other
// unverified constant that came out of that same build chat (router/pool
// addresses, token decimals, chain id) with the same suspicion.
//
// ── Open decision: equity feeds only publish during regular market hours ─────
// Pyth ships FOUR feeds per US equity: the regular-session feed used below,
// plus `.PRE`, `.POST`, and `.ON` (overnight) variants. The regular feed goes
// stale outside 09:30–16:00 ET, so overnight and at weekends a price condition
// on any equity asset evaluates against a stale price or none at all — a silent
// no-op, which is the exact failure mode `apps/worker/src/preflight.ts` calls
// the worst possible one for a system that moves money on price triggers.
// The regular-session feed is used here because it preserves the original
// intent of this file (the transcribed ids were all regular-session ids). If
// Oplier needs triggers to fire round the clock, swap in the `.ON` ids — that
// is a product decision, not a lookup. NOTE this now affects gold too, which
// is an equity feed as of this fix (see test_gold below).
//
// The asset registry (Part A/B, `asset_registry.price_feed_id`) is the
// long-term source of truth for this mapping per doc 05 §2 — this local
// constant is a fallback/seed value and a place to hang the verification
// flag, not a second source of truth the app should read from once the
// registry is wired up. `PythAdapter` accepts a `resolveFeedId` function so
// callers can swap in the registry-backed lookup without touching adapter
// logic.
// =============================================================================

export interface FeedRegistryEntry {
  /** Pyth Hermes price feed id (hex, no 0x prefix, as Pyth's own docs render them). */
  feedId: string;
  /** Underlying reference asset symbol (doc 05 §1's tAAPL/AAPL distinction). */
  underlying: string;
  /** True once a human has confirmed this id against Pyth's live registry. */
  verified: boolean;
  note?: string;
}

/**
 * Feed ids verified live 2026-08-19 — see module doc comment. Keyed by `asset_id` (asset registry
 * convention, e.g. "test_aapl"), not by symbol, matching full_schema.txt.
 *
 * ASSET ID CORRECTION (Part I, 2026-08-19): two keys in this map did not match the real
 * `asset_registry.asset_id` values seeded by `packages/db/src/seed.ts`, which is the
 * authoritative source (assetId is the FK target referenced by systems/swaps/positions/
 * transactions, per that file's own note):
 *   - `test_gld`  ->  `test_gold`   (seed.ts line 85)
 *   - `usdg`      ->  `test_usdg`   (seed.ts line 112)
 * Both were silent runtime bugs, not cosmetic: the engine passes `asset_registry.asset_id`
 * values straight through to `getCurrentPrice`, so GLDx lookups raised
 * `PriceUnavailableError` for an asset that exists, and USDG never reached its peg-check
 * branch in `pyth-adapter.ts` (which compared against the literal `"usdg"`), meaning the
 * default settlement/quote asset threw instead of returning its $1.00 peg. `@oplier/amm-execution`
 * already used the correct `test_gold`/`test_usdg` spellings, so this file was the sole
 * outlier across the four wired packages.
 */
export const PYTH_FEED_REGISTRY: Record<string, FeedRegistryEntry> = {
  test_aapl: {
    feedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
    underlying: "AAPL",
    verified: true,
    note: "Equity.US.AAPL/USD, verified live 2026-08-19. The previous value was 63 chars and wrong from char 62 on — the first 61 chars were correct, which is what made it look plausible. Regular-session feed; see the market-hours note in the module header.",
  },
  test_meta: {
    feedId: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe",
    underlying: "META",
    verified: true,
    note: "Equity.US.META/USD, verified live 2026-08-19 — unchanged, this id was correct all along. The previous note claimed it was 'deliberately malformed to force a real lookup'; that was fiction and it caused the worker's preflight failure message to blame this asset for the other three assets' bad ids. Regular-session feed; see the market-hours note in the module header.",
  },
  test_nvda: {
    feedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    underlying: "NVDA",
    verified: true,
    note: "Equity.US.NVDA/USD, verified live 2026-08-19. The previous value was 63 chars and diverged from char 38 on — over a third of the id was invented, so there was nothing to salvage. Regular-session feed; see the market-hours note in the module header.",
  },
  test_gold: {
    feedId: "e190f467043db04548200354889dfe0d9d314c08b8d4e62fabf4d5a3140fecca",
    underlying: "GLD",
    verified: true,
    note: "Equity.US.GLD/USD, verified live 2026-08-19. TWO changes here, both deliberate. (1) Key was corrected from `test_gld` to `test_gold` to match asset_registry.asset_id (Part I). (2) REFERENCE ASSET SWITCHED from Pyth's Metal.XAU/USD (spot gold) to the GLD equity feed. The old note asked whether Pyth publishes a GLD-equity feed distinct from XAU/USD — it does, and 00_MASTER_BUILD_PLAN.md lines 199 and 205 settle which to use: `underlying_asset` references the true underlying for Pyth price mapping (doc 05 §4), and GLDx's underlying is SPDR Gold Shares (`GLD`), not `GOLD`/spot. This is a ~10.9x price-level change, NOT a cosmetic one: GLD was $412.41 and XAU $4496.19 at time of fix, and GLDx's own market price (~$412) confirms the equity feed is the right reference. Any price/ROI condition calibrated against the old spot-gold number is now off by an order of magnitude and must be re-set. Old XAU id, if this ever needs reverting: 765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2. Note gold is now subject to the same regular-market-hours caveat as the equities.",
  },
  test_usdg: {
    feedId: "",
    underlying: "USDG",
    verified: false,
    note: "Key corrected from `usdg` to `test_usdg` to match asset_registry.asset_id (Part I) — with the old key, the peg-check fallback in pyth-adapter.ts was unreachable and USDG threw PriceUnavailableError. OPEN QUESTION NOW ANSWERED, BUT DELIBERATELY NOT WIRED IN: Pyth does publish a USDG feed — Crypto.USDG/USD, id daa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da, verified to exist 2026-08-19. It is left empty here because populating it changes behaviour: it would route the default settlement/quote asset away from the $1.00 peg-check branch in pyth-adapter.ts and onto a live feed that can print off-peg, which is a pricing decision for whoever owns settlement, not a bug fix. `feedId: \"\"` is handled as an expected warning by the worker preflight, so this stays green. Populate it (and set verified: true) if and when the peg-check fallback is intentionally retired.",
  },
};

/** Default (registry-independent) feed id lookup, given the caveats above. */
export function resolveFeedIdFromLocalRegistry(assetId: string): FeedRegistryEntry | null {
  return PYTH_FEED_REGISTRY[assetId] ?? null;
}
