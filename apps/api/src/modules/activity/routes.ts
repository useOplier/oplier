import type { FastifyInstance } from "fastify";
import { eq, and, or, lt, desc, type SQL } from "drizzle-orm";
import { transactions } from "@oplier/db";
import { paginatedActivityResponseSchema, ApiError } from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";
import { encodeCursor, decodeCursor } from "../../lib/pagination.js";

const PAGE_SIZE = 50;

/**
 * GET /activity?cursor=&limit= — doc 06 §6, paginated (Part B brief §4). Keyset pagination on
 * (timestamp, id) rather than OFFSET, so the page stays stable as new transactions land while
 * the user has the screen open (doc 05 §16 — transactions arrive continuously as Systems fire).
 */
export default async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/activity",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const limit = Math.min(Math.max(Number(request.query.limit) || PAGE_SIZE, 1), 100);

      const conditions_: SQL[] = [eq(transactions.walletAddress, walletAddress)];
      if (request.query.cursor) {
        const cursor = decodeCursor(request.query.cursor);
        const cursorDate = new Date(cursor.timestamp);
        if (Number.isNaN(cursorDate.getTime())) {
          throw new ApiError("VALIDATION_ERROR", "Invalid cursor timestamp.");
        }
        // Strictly older than the cursor row, tie-broken by id so identical timestamps don't
        // cause skipped/duplicated rows across pages.
        conditions_.push(
          or(
            lt(transactions.timestamp, cursorDate),
            and(eq(transactions.timestamp, cursorDate), lt(transactions.id, cursor.id)),
          )!,
        );
      }

      const rows = await fastify.db
        .select()
        .from(transactions)
        .where(and(...conditions_))
        .orderBy(desc(transactions.timestamp), desc(transactions.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      reply.send(
        paginatedActivityResponseSchema.parse({
          items: page.map((r) => ({
            id: r.id,
            source: r.source,
            systemId: r.systemId,
            txHash: r.txHash,
            status: r.status,
            sourceAsset: r.sourceAsset,
            destinationAsset: r.destinationAsset,
            amountIn: r.amountIn,
            amountOut: r.amountOut,
            timestamp: r.timestamp.toISOString(),
          })),
          nextCursor:
            hasMore && last
              ? encodeCursor({ timestamp: last.timestamp.toISOString(), id: last.id })
              : null,
        }),
      );
    },
  );
}
