import type { FastifyInstance } from "fastify";
import { desc, eq, gte, and } from "drizzle-orm";
import { assetPrices, assetRegistry, highImpactNewsEvents, positions } from "@oplier/db";
import { getProviderForRole } from "@oplier/llm";
import { requireAuth } from "../../auth/auth-plugin.js";

/**
 * GET /insights — the AI Insight surface on Home (doc 01 §3).
 *
 * WHY THIS FILE EXISTS: the frontend has always called `/insights`, but the route was never built, so
 * Home got a 404 on every load. `apps/web/src/lib/api/client.ts` flagged it explicitly rather than
 * inventing a shape ("FLAGGED, NOT SILENTLY INVENTED… needs an explicit answer from Part B") and fails
 * soft to an empty list, which is why the page still rendered while the feature was simply absent.
 *
 * The response shape is fixed by the frontend's existing `AiInsight` type — `{ id, headline, body,
 * relatedNewsId }` — so this conforms to the consumer rather than defining a new contract.
 *
 * Insights are GENERATED, not templated: the grounding facts (the caller's open positions, the latest
 * price per asset, upcoming High Impact news) are read from Postgres and handed to LLM1 to summarise.
 * Everything the model is allowed to talk about therefore comes from our own DB, which is what keeps
 * this from fabricating market claims — the brief's "never fabricate a price" applies just as much to
 * prose about prices as to the numbers themselves.
 */

/** Kept small: this renders as a few cards on Home, and every extra item is latency the user waits on. */
const MAX_INSIGHTS = 3;

/**
 * Output budget. Generous relative to the ~3 short cards actually wanted, because newer Gemini models
 * spend part of the output allowance on internal reasoning before emitting any answer.
 *
 * Measured: at 700 the model returned valid but TRUNCATED JSON — `{"insights":\n[{"headline":"No Active
 * Open Positions","body":"Your portfolio currently holds no open positions. Prices for tracked assets
 * like META, NVDA,` and nothing more — so `JSON.parse` failed and the route degraded to an empty list.
 * It intermittently succeeded, which is the tell: reasoning length varies per call, so a tight cap
 * truncates some responses and not others. Sizing for the worst case is cheaper than a flaky feature.
 */
const INSIGHT_MAX_TOKENS = 3000;
const INSIGHT_TEMPERATURE = 0.2;
const SYSTEM_PROMPT = `You write short portfolio insights for a tokenized-RWA trading app.

You will be given JSON containing ONLY: the user's open positions, the latest known price per asset, and
upcoming high-impact macro events. Those facts are the complete universe of what you may assert.

Rules:
- Use ONLY the supplied facts. Never invent a price, a holding, an event, or a market claim.
- If the facts are thin, return fewer insights. Returning one good insight beats padding to three.
- No financial advice and no directional predictions. Describe what is true and why it may matter.
- Each insight: a headline under 70 characters, and a body of one or two plain sentences.
- If an insight is about a supplied news event, set relatedNewsId to that event's id. Otherwise null.

Respond with RAW JSON only — no markdown fence, no prose around it:
{"insights":[{"headline":"...","body":"...","relatedNewsId":null}]}`;

interface GeneratedInsight {
  headline: string;
  body: string;
  relatedNewsId: string | null;
}

/**
 * Providers are told to emit bare JSON, but some still wrap it in a ```json fence or add a sentence
 * before it. Rather than trusting the instruction, pull out the outermost JSON object.
 */
function parseInsights(raw: string): GeneratedInsight[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }

  const items = (parsed as { insights?: unknown })?.insights;
  if (!Array.isArray(items)) return [];

  return items
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      headline: typeof i.headline === "string" ? i.headline : "",
      body: typeof i.body === "string" ? i.body : "",
      relatedNewsId: typeof i.relatedNewsId === "string" ? i.relatedNewsId : null,
    }))
    .filter((i) => i.headline !== "" && i.body !== "")
    .slice(0, MAX_INSIGHTS);
}

export default async function insightsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/insights", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;

    const [holdings, prices, news] = await Promise.all([
      fastify.db
        .select({
          symbol: assetRegistry.symbol,
          assetId: positions.assetId,
          quantity: positions.quantity,
          costBasis: positions.costBasis,
        })
        .from(positions)
        .innerJoin(assetRegistry, eq(positions.assetId, assetRegistry.assetId))
        .where(and(eq(positions.walletAddress, walletAddress), eq(positions.status, "OPEN"))),
      fastify.db
        .select({ assetId: assetPrices.assetId, price: assetPrices.price, observedAt: assetPrices.observedAt })
        .from(assetPrices),
      fastify.db
        .select()
        .from(highImpactNewsEvents)
        .where(gte(highImpactNewsEvents.eventTimestamp, new Date()))
        .orderBy(highImpactNewsEvents.eventTimestamp)
        .limit(5),
    ]);

    const facts = {
      openPositions: holdings.map((h) => ({
        symbol: h.symbol,
        quantity: Number(h.quantity),
        costBasis: h.costBasis === null ? null : Number(h.costBasis),
      })),
      latestPrices: prices.map((p) => ({
        assetId: p.assetId,
        price: Number(p.price),
        observedAt: p.observedAt.toISOString(),
      })),
      upcomingHighImpactNews: news.map((n) => ({
        id: n.id,
        event: n.event,
        eventTimestamp: n.eventTimestamp.toISOString(),
        country: n.country,
        impactLevel: n.impactLevel,
      })),
    };

    // Nothing to ground an insight in — return empty rather than inviting the model to invent one.
    if (
      facts.openPositions.length === 0 &&
      facts.latestPrices.length === 0 &&
      facts.upcomingHighImpactNews.length === 0
    ) {
      reply.send({ items: [] });
      return;
    }

    /**
     * A failed or malformed completion degrades to an empty list, never a 5xx. Home renders insights
     * as a supplementary panel; taking the whole page down because a vendor is having a bad minute
     * would be a worse outcome than showing nothing. Logged so it is visible rather than silent.
     */
    let generated: GeneratedInsight[] = [];
    try {
      const provider = getProviderForRole("LLM1");
      const result = await provider.complete({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        maxTokens: INSIGHT_MAX_TOKENS,
        temperature: INSIGHT_TEMPERATURE,
      });
      generated = parseInsights(result.text ?? "");
      if (generated.length === 0) {
        fastify.log.warn({ text: result.text?.slice(0, 400) }, "insights: completion produced no usable items");
      }
    } catch (err) {
      fastify.log.error({ err }, "insights: provider call failed");
    }

    /**
     * `relatedNewsId` is validated against the ids we actually supplied. A model that echoes a
     * plausible-looking id we never sent would otherwise produce a dangling reference the frontend
     * would try to resolve.
     */
    const knownNewsIds = new Set(facts.upcomingHighImpactNews.map((n) => n.id));

    reply.send({
      items: generated.map((insight, i) => ({
        // Derived from position, not random: Home re-fetches, and a fresh uuid each poll would break
        // React keys and any client-side dismissal state.
        id: `insight-${i}`,
        headline: insight.headline,
        body: insight.body,
        relatedNewsId:
          insight.relatedNewsId && knownNewsIds.has(insight.relatedNewsId) ? insight.relatedNewsId : null,
      })),
    });
  });
}
