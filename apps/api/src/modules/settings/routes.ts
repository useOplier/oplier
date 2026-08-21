import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { settings, memorySummary } from "@oplier/db";
import { settingsResponseSchema, patchSettingsRequestSchema, ApiError } from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";

/**
 * GET/PATCH /settings — doc 06 §7. `memoryEnabled` actually lives on `memory_summary`
 * (packages/db/src/schema/memory.ts), not `settings` — this module joins the two so the
 * Settings screen gets one flat response despite the two-table split.
 */
export default async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/settings", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const [settingsRow, memoryRow] = await Promise.all([
      fastify.db.select().from(settings).where(eq(settings.walletAddress, walletAddress)).limit(1),
      fastify.db
        .select({ memoryEnabled: memorySummary.memoryEnabled })
        .from(memorySummary)
        .where(eq(memorySummary.walletAddress, walletAddress))
        .limit(1),
    ]);

    // First GET after account creation: no settings/memory row exists yet — return locked
    // MVP defaults (doc 06 §7: 1% default slippage; doc 02 Timezone: "assigned automatically")
    // rather than a 404, since these are conceptually always-present per-user settings.
    const row = settingsRow[0];
    const memoryEnabled = memoryRow[0]?.memoryEnabled ?? true;

    reply.send(
      settingsResponseSchema.parse({
        timezone: row?.timezone ?? "UTC",
        maxSlippageDefaultBps: row?.maxSlippageDefaultBps ?? 100,
        memoryEnabled,
      }),
    );
  });

  fastify.patch("/settings", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const body = patchSettingsRequestSchema.parse(request.body);

    const settingsPatch: Partial<typeof settings.$inferInsert> = {};
    if (body.timezone !== undefined) settingsPatch.timezone = body.timezone;
    if (body.maxSlippageDefaultBps !== undefined) {
      settingsPatch.maxSlippageDefaultBps = body.maxSlippageDefaultBps;
    }

    if (Object.keys(settingsPatch).length > 0) {
      await fastify.db
        .insert(settings)
        .values({ walletAddress, ...settingsPatch })
        .onConflictDoUpdate({ target: settings.walletAddress, set: settingsPatch });
    }

    if (body.memoryEnabled !== undefined) {
      await fastify.db
        .insert(memorySummary)
        .values({ walletAddress, memoryEnabled: body.memoryEnabled })
        .onConflictDoUpdate({
          target: memorySummary.walletAddress,
          set: { memoryEnabled: body.memoryEnabled },
        });
    }

    const [settingsRow] = await fastify.db
      .select()
      .from(settings)
      .where(eq(settings.walletAddress, walletAddress))
      .limit(1);
    const [memoryRow] = await fastify.db
      .select({ memoryEnabled: memorySummary.memoryEnabled })
      .from(memorySummary)
      .where(eq(memorySummary.walletAddress, walletAddress))
      .limit(1);

    if (!settingsRow) {
      throw new ApiError("INTERNAL_ERROR", "Settings row missing after upsert.");
    }

    reply.send(
      settingsResponseSchema.parse({
        timezone: settingsRow.timezone,
        maxSlippageDefaultBps: settingsRow.maxSlippageDefaultBps,
        memoryEnabled: memoryRow?.memoryEnabled ?? true,
      }),
    );
  });
}
