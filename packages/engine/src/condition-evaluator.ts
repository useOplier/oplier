/**
 * Condition evaluation (brief responsibility #3).
 *
 * Implements the 5 MVP primitives (PRICE_VALUE, PRICE_PERCENT, ROI, TIME,
 * HIGH_IMPACT_NEWS) and flat AND/OR group combination within a step (no nesting).
 *
 * Edge detection ("evaluate on data change... FALSE→TRUE transition triggers eligibility;
 * TRUE→TRUE does nothing" — brief §3): the *group's* combined state is what needs an edge,
 * not just each individual condition's. The schema only stores `currentState` per
 * individual `conditions` row (see full_schema.txt `conditions.ts`), not a group-level
 * flag, so the previous group state is *derived* by combining each condition's
 * previously-stored `currentState` with the step's `groupOperator`, then compared against
 * the newly (re-)evaluated combination. Both a previous and a next `GroupEvaluationResult`
 * come back from `evaluateGroup` for exactly this reason.
 */

import type {
  ConditionRecord,
  ConditionType,
  GroupOperator,
  HighImpactNewsParams,
  NewsDataProvider,
  PriceDataProvider,
  PriceValueParams,
  PricePercentOrRoiParams,
  TimeParams,
} from "./types.js";

export interface EvaluationContext {
  priceProvider: PriceDataProvider;
  newsProvider: NewsDataProvider;
  /** Current ROI reference per asset: (costBasis, quantity) from the System's open position, if any. */
  getPositionForRoi(assetId: string): Promise<{ costBasis: number; quantity: number } | null>;
  /** App-wide timezone for TIME conditions (doc 02 "Timezone" — one universal, per-user, app timezone; Systems use it). */
  timezone: string;
  /**
   * Baseline price for PRICE_PERCENT, keyed by conditionId. See ASSUMPTIONS.md /
   * ENGINE_CONTRACT.md "Open questions" — docs 04/05 (not available in this build chat)
   * presumably define what a percentage move is relative to; this engine captures the
   * price the *first time* a PRICE_PERCENT condition is evaluated after entering WAITING
   * and treats that as the 0% baseline, held by the caller (see `BaselinePriceStore`) so it
   * survives across evaluation cycles within a run but resets on reactivation.
   */
  getOrSetPricePercentBaseline(conditionId: string, currentPrice: number): Promise<number>;
}

export interface GroupEvaluationResult {
  groupState: boolean;
  perCondition: Array<{ conditionId: string; state: boolean }>;
}

export async function evaluateCondition(
  condition: ConditionRecord,
  ctx: EvaluationContext,
): Promise<boolean> {
  switch (condition.conditionType) {
    case "PRICE_VALUE":
      return evaluatePriceValue(condition.parameters as PriceValueParams, ctx);
    case "PRICE_PERCENT":
      return evaluatePricePercent(condition.id, condition.parameters as PricePercentOrRoiParams, ctx);
    case "ROI":
      return evaluateRoi(condition.parameters as PricePercentOrRoiParams, ctx);
    case "TIME":
      return evaluateTime(condition.parameters as TimeParams, ctx.timezone);
    case "HIGH_IMPACT_NEWS":
      return evaluateHighImpactNews(condition.parameters as HighImpactNewsParams, ctx);
    default: {
      const _exhaustive: never = condition.conditionType;
      throw new Error(`Unhandled condition type: ${_exhaustive as ConditionType}`);
    }
  }
}

async function evaluatePriceValue(params: PriceValueParams, ctx: EvaluationContext): Promise<boolean> {
  const snapshot = await ctx.priceProvider.getCurrentPrice(params.asset);
  if (snapshot.isStale) return false; // doc 05 §6: never trigger from stale data
  switch (params.operator) {
    case "EQ":
      return snapshot.price === params.value;
    case "GT":
      return snapshot.price > params.value;
    case "LT":
      return snapshot.price < params.value;
  }
}

async function evaluatePricePercent(
  conditionId: string,
  params: PricePercentOrRoiParams,
  ctx: EvaluationContext,
): Promise<boolean> {
  const snapshot = await ctx.priceProvider.getCurrentPrice(params.asset);
  if (snapshot.isStale) return false;
  const baseline = await ctx.getOrSetPricePercentBaseline(conditionId, snapshot.price);
  if (baseline === 0) return false; // avoid div-by-zero; degenerate baseline can't produce a % move
  const changePct = ((snapshot.price - baseline) / baseline) * 100;
  if (params.direction === "UP") return changePct >= params.percent;
  return changePct <= -params.percent;
}

async function evaluateRoi(params: PricePercentOrRoiParams, ctx: EvaluationContext): Promise<boolean> {
  const position = await ctx.getPositionForRoi(params.asset);
  // No open position yet => no cost basis to compute a return against.
  if (!position || position.quantity === 0 || position.costBasis === 0) return false;

  // doc 05 §17 / doc 04 §7 (confirmed, not an assumption): ROI % = (Current Position Value -
  // Cost Basis) / Cost Basis × 100, where "Current Position Value" is the position's quantity
  // priced at the live Pyth reference price (doc 05 §4: Pyth, not QuickSwap pool price, is used
  // for "ROI calculations") — NOT a raw quantity-vs-cost-basis unit comparison, which an
  // earlier draft of this function used incorrectly. Fetched fresh here rather than trusting a
  // possibly-stale `positions.currentValue` column, since staleness rules (doc 05 §6) apply the
  // same way to ROI as to price conditions.
  const priceSnapshot = await ctx.priceProvider.getCurrentPrice(params.asset);
  if (priceSnapshot.isStale) return false;
  const currentPositionValue = position.quantity * priceSnapshot.price;
  const roiPct = ((currentPositionValue - position.costBasis) / position.costBasis) * 100;

  if (params.direction === "UP") return roiPct >= params.percent;
  return roiPct <= -params.percent;
}

function evaluateTime(params: TimeParams, timezone: string): boolean {
  if (!params.date && !params.time) return false;
  const { year, month, day, hour, minute } = getZonedParts(timezone);

  if (params.date) {
    const [ty, tm, td] = params.date.split("-").map(Number);
    const [th, tmin] = (params.time ?? "00:00").split(":").map(Number);
    const nowValue = year * 100000000 + month * 1000000 + day * 10000 + hour * 100 + minute;
    const targetValue = ty! * 100000000 + tm! * 1000000 + td! * 10000 + th! * 100 + tmin!;
    return nowValue >= targetValue;
  }
  // time-only: fires once per day at/after that clock time, in the app's universal timezone
  // (doc 02 "Timezone": "One universal app timezone... Systems use the universal timezone").
  const [h, m] = (params.time as string).split(":").map(Number);
  return hour > h! || (hour === h! && minute >= m!);
}

/** Reads the current date/time's components in a given IANA timezone without a date library. */
function getZonedParts(timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

async function evaluateHighImpactNews(params: HighImpactNewsParams, ctx: EvaluationContext): Promise<boolean> {
  return ctx.newsProvider.hasUpcomingHighImpactEvent(params.withinHours);
}

export async function evaluateGroup(
  groupOperator: GroupOperator,
  conditions: ConditionRecord[],
  ctx: EvaluationContext,
): Promise<GroupEvaluationResult> {
  const perCondition = await Promise.all(
    conditions.map(async (c) => ({ conditionId: c.id, state: await evaluateCondition(c, ctx) })),
  );
  const groupState =
    groupOperator === "AND" ? perCondition.every((c) => c.state) : perCondition.some((c) => c.state);
  return { groupState, perCondition };
}

/** Derives the group's *previous* combined state from each condition's last-persisted `currentState`. */
export function derivePreviousGroupState(groupOperator: GroupOperator, conditions: ConditionRecord[]): boolean {
  if (conditions.length === 0) return false;
  return groupOperator === "AND"
    ? conditions.every((c) => c.currentState)
    : conditions.some((c) => c.currentState);
}

/**
 * In-memory baseline store for PRICE_PERCENT (see EvaluationContext doc comment above).
 * Cleared per-run so reactivation starts every PRICE_PERCENT condition at a fresh 0%
 * baseline, matching the "no previous condition-trigger state" reset doc 05 §22 already
 * mandates for `currentState` generally.
 *
 * RATCHETING (confirmed by the manager thread): the baseline is not fixed at first
 * evaluation and left alone — it resets to the price observed at each successful execution.
 * Doc 01 §1's own example ("buys $10 worth of AAPL every time it drops 5%, until I own $50
 * worth") only behaves as described if each subsequent buy's -5% is measured from the price
 * at the *previous* buy, not from the System's original creation-time price; a fixed
 * baseline would only ever fire once per approach to that one original price. `set()` is the
 * explicit ratchet (unconditional overwrite, called from `engine.ts`'s `onStepSucceeded` for
 * whichever step becomes current next); `getOrSet()` remains the fallback for a step's first
 * ever evaluation (no prior execution to ratchet from — e.g. Step 1 of a run).
 */
export class BaselinePriceStore {
  private baselines = new Map<string, number>();

  async getOrSet(conditionId: string, currentPrice: number): Promise<number> {
    const existing = this.baselines.get(conditionId);
    if (existing !== undefined) return existing;
    this.baselines.set(conditionId, currentPrice);
    return currentPrice;
  }

  /** Unconditional ratchet — overwrites any existing baseline for this condition. */
  set(conditionId: string, price: number): void {
    this.baselines.set(conditionId, price);
  }

  clearForConditions(conditionIds: string[]): void {
    for (const id of conditionIds) this.baselines.delete(id);
  }

  clearAll(): void {
    this.baselines.clear();
  }
}