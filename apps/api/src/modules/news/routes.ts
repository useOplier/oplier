import type { FastifyInstance } from "fastify";
import { gte } from "drizzle-orm";
import { highImpactNewsEvents } from "@oplier/db";
import { highImpactNewsEventSchema } from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";

/**
 * GET /high-impact-news — doc 02: "Before creating a news-based System, the AI must show the
 * user the events currently classified as High Impact." Only upcoming events are returned
 * (eventTimestamp >= now) — past events aren't relevant to "what's coming up" review.
 */
export default async function newsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/high-impact-news", { preHandler: requireAuth }, async (_request, reply) => {
    const rows = await fastify.db
      .select()
      .from(highImpactNewsEvents)
      .where(gte(highImpactNewsEvents.eventTimestamp, new Date()))
      .orderBy(highImpactNewsEvents.eventTimestamp);

    reply.send({
      items: rows.map((r) =>
        highImpactNewsEventSchema.parse({
          id: r.id,
          event: r.event,
          eventTimestamp: r.eventTimestamp.toISOString(),
          country: r.country,
          eventType: r.eventType,
          impactLevel: r.impactLevel,
          sourceUrl: r.sourceUrl,
        }),
      ),
    });
  });
}
