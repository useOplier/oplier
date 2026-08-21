import type { FastifyInstance } from "fastify";
import { eq, desc } from "drizzle-orm";
import { positions } from "@oplier/db";
import { positionResponseSchema } from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";

/** GET /positions — doc 06 §8. Both OPEN and CLOSED positions, unlike GET /portfolio. */
export default async function positionsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/positions", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const rows = await fastify.db
      .select()
      .from(positions)
      .where(eq(positions.walletAddress, walletAddress))
      .orderBy(desc(positions.openedAt));

    reply.send({
      items: rows.map((r) =>
        positionResponseSchema.parse({
          id: r.id,
          systemId: r.systemId,
          assetId: r.assetId,
          status: r.status,
          costBasis: r.costBasis,
          quantity: r.quantity,
          currentValue: r.currentValue,
          openedAt: r.openedAt.toISOString(),
          closedAt: r.closedAt ? r.closedAt.toISOString() : null,
        }),
      ),
    });
  });
}
