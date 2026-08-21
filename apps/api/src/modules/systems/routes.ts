import type { FastifyInstance } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { systems, executions, systemSteps, conditions, swaps, systemRuns } from "@oplier/db";
import {
  ApiError,
  createSystemRequestSchema,
  createSystemResponseSchema,
  modifySystemRequestSchema,
  systemsListResponseSchema,
  systemDetailResponseSchema,
  validateSystemResponseSchema,
  type SystemSpec,
} from "@oplier/shared-types";
import { requireAuth } from "../../auth/auth-plugin.js";
import { AssetRegistryService } from "../../registries/asset-registry.service.js";
import { CapabilityRegistryService } from "../../registries/capability-registry.service.js";
import { validateSystemSpec } from "../../registries/validate-system-spec.js";
import { SystemEngineServiceStub } from "./system-engine.stub.js";

export default async function systemsRoutes(fastify: FastifyInstance): Promise<void> {
  // TESTNET only for the hackathon MVP deployment (doc 01 §12) — see API_CONTRACT.md for how
  // this would become environment-aware (env var) once a MAINNET deployment exists.
  const assetRegistry = new AssetRegistryService(fastify.db, "TESTNET");
  const capabilityRegistry = new CapabilityRegistryService(fastify.db);
  const engine = new SystemEngineServiceStub(fastify.db, assetRegistry, capabilityRegistry);

  /**
   * POST /systems/validate — NOT in the brief's literal endpoint list. Added so a System can
   * be shown to the user for review (doc 02 "System is shown to the user" step) before
   * anything is persisted or any (currently nonexistent) Nexus permission is requested. See
   * API_CONTRACT.md "Additions beyond the literal Part B endpoint list."
   */
  fastify.post("/systems/validate", { preHandler: requireAuth }, async (request, reply) => {
    const raw = createSystemRequestSchema.parse(request.body);
    const result = await validateSystemSpec(raw, { assetRegistry, capabilityRegistry });
    if (!result.valid) {
      throw new ApiError("UNSUPPORTED_CAPABILITY", "System spec failed validation.", result.issues);
    }
    reply.send(validateSystemResponseSchema.parse({ valid: true, spec: result.spec }));
  });

  fastify.post("/systems", { preHandler: requireAuth }, async (request, reply) => {
    const raw = createSystemRequestSchema.parse(request.body);
    const walletAddress = request.user!.walletAddress;
    const { systemId } = await engine.createSystem(walletAddress, raw as SystemSpec);
    // AUTHORIZATION_REQUIRED, not ACTIVE: creation persists and validates the System but does not
    // authorize it — the worker grants the on-chain session key and promotes it to ACTIVE. The web
    // client already renders this status as a "Needs authorization" badge while that is pending.
    reply
      .status(201)
      .send(createSystemResponseSchema.parse({ id: systemId, status: "AUTHORIZATION_REQUIRED" }));
  });

  fastify.get("/systems", { preHandler: requireAuth }, async (request, reply) => {
    const walletAddress = request.user!.walletAddress;
    const rows = await fastify.db
      .select()
      .from(systems)
      .where(eq(systems.walletAddress, walletAddress))
      .orderBy(desc(systems.createdAt));
    reply.send(
      systemsListResponseSchema.parse({
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          maxAllocation: r.maxAllocation,
          maxAllocationAsset: r.maxAllocationAsset,
          createdAt: r.createdAt.toISOString(),
        })),
      }),
    );
  });

  fastify.get<{ Params: { id: string } }>(
    "/systems/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const { id } = request.params;

      const [system] = await fastify.db
        .select()
        .from(systems)
        .where(and(eq(systems.id, id), eq(systems.walletAddress, walletAddress)))
        .limit(1);
      if (!system) throw new ApiError("NOT_FOUND", `System "${id}" not found.`);

      const stepRows = await fastify.db
        .select()
        .from(systemSteps)
        .where(eq(systemSteps.systemId, id))
        .orderBy(systemSteps.stepOrder);

      const spec: SystemSpec = {
        name: system.name,
        maxAllocation: system.maxAllocation,
        maxAllocationAsset: system.maxAllocationAsset,
        executionLimit: system.executionLimit,
        expiresAt: system.expiresAt ? system.expiresAt.toISOString() : null,
        steps: await Promise.all(
          stepRows.map(async (step) => {
            const [conditionRows, swapRows] = await Promise.all([
              fastify.db.select().from(conditions).where(eq(conditions.stepId, step.id)),
              fastify.db.select().from(swaps).where(eq(swaps.stepId, step.id)),
            ]);
            const swapRow = swapRows[0];
            if (!swapRow) {
              // Should be unreachable — swaps.stepId is a NOT NULL unique FK to system_steps,
              // so every step has exactly one swap. Surfacing as INTERNAL_ERROR rather than
              // silently omitting the step if this invariant is ever violated.
              throw new ApiError("INTERNAL_ERROR", `Step "${step.id}" has no swap row.`);
            }
            return {
              stepOrder: step.stepOrder,
              groupOperator: step.groupOperator,
              conditions: conditionRows.map((c) => ({
                conditionType: c.conditionType,
                parameters: c.parameters,
              })) as SystemSpec["steps"][number]["conditions"],
              swap: {
                sourceAsset: swapRow.sourceAsset,
                destinationAsset: swapRow.destinationAsset,
                amountType: swapRow.amountType,
                amountValue: swapRow.amountValue,
                executionOrder: swapRow.executionOrder,
                maxSlippageBps: swapRow.maxSlippageBps,
              },
            };
          }),
        ),
      };

      const executionRows = await fastify.db
        .select()
        .from(executions)
        .where(eq(executions.systemId, id))
        .orderBy(desc(executions.createdAt));

      reply.send(
        systemDetailResponseSchema.parse({
          id: system.id,
          name: system.name,
          status: system.status,
          spec,
          currentRunId: system.currentRunId,
          createdAt: system.createdAt.toISOString(),
          updatedAt: system.updatedAt.toISOString(),
          executions: executionRows.map((e) => ({
            id: e.id,
            runId: e.runId,
            stepId: e.stepId,
            state: e.state,
            status: e.status,
            retryable: e.retryable,
            errorLog: e.errorLog,
            attemptCount: e.attemptCount,
            txHash: e.txHash,
            createdAt: e.createdAt.toISOString(),
            updatedAt: e.updatedAt.toISOString(),
          })),
        }),
      );
    },
  );

  fastify.patch<{ Params: { id: string } }>(
    "/systems/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const body = modifySystemRequestSchema.parse(request.body);
      const walletAddress = request.user!.walletAddress;
      const { systemId } = await engine.modifySystem(walletAddress, request.params.id, body);
      reply.send({ id: systemId });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    "/systems/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      await engine.deleteSystem(walletAddress, request.params.id);
      reply.status(204).send();
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/systems/:id/pause",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const result = await engine.pauseSystem(walletAddress, request.params.id);
      reply.send(result);
    },
  );

  fastify.post<{ Params: { id: string } }>(
    "/systems/:id/resume",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const result = await engine.resumeSystem(walletAddress, request.params.id);
      reply.send(result);
    },
  );

  /**
   * POST /systems/:id/reactivate — NOT in the brief's literal endpoint list. Doc 04 §14 is a
   * locked product behavior with no other endpoint to live under; added and flagged. See
   * API_CONTRACT.md.
   */
  fastify.post<{ Params: { id: string } }>(
    "/systems/:id/reactivate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const result = await engine.reactivateSystem(walletAddress, request.params.id);
      reply.send(result);
    },
  );

  /**
   * POST /systems/:id/reauthorize — NOT in the brief's literal endpoint list, same reasoning
   * as reactivate. Sets the System to AUTHORIZATION_REQUIRED so the worker re-grants its session
   * key on the next activation cycle; idempotent, safe to retry.
   */
  fastify.post<{ Params: { id: string } }>(
    "/systems/:id/reauthorize",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const result = await engine.reauthorizeSystem(walletAddress, request.params.id);
      reply.send(result);
    },
  );

  /**
   * DELETE /systems/:id/logs — doc 05 §32 "Delete Logs" — user-initiated clearing of execution
   * history WITHOUT deleting the System itself. Not in the brief's literal list; added because
   * doc 05 §32 explicitly distinguishes it from System deletion and there's no other home for
   * it.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/systems/:id/logs",
    { preHandler: requireAuth },
    async (request, reply) => {
      const walletAddress = request.user!.walletAddress;
      const [system] = await fastify.db
        .select({ id: systems.id })
        .from(systems)
        .where(and(eq(systems.id, request.params.id), eq(systems.walletAddress, walletAddress)))
        .limit(1);
      if (!system) throw new ApiError("NOT_FOUND", `System "${request.params.id}" not found.`);

      await fastify.db.delete(executions).where(eq(executions.systemId, system.id));
      reply.status(204).send();
    },
  );
}
