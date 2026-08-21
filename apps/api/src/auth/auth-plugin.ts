import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ApiError } from "@oplier/shared-types";
import { verifyAccessToken } from "./jwt.js";
import { loadEnv } from "../config/env.js";

export interface AuthenticatedUser {
  walletAddress: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

/**
 * Decorates every request with a `user` property (null until `requireAuth` runs and
 * populates it). Registered as a root-level plugin via fastify-plugin so the decoration is
 * visible everywhere, including in routes that don't use `requireAuth` at all.
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest("user", null);
});

/**
 * Route-level guard: `fastify.get("/systems", { preHandler: requireAuth }, handler)`.
 * Reads `Authorization: Bearer <token>`, verifies it, and sets `request.user`. Every
 * protected route reads the wallet address from `request.user`, never from a request body/
 * query param — the authenticated session is always the source of truth for "which user."
 */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError("UNAUTHORIZED", "Missing or malformed Authorization header.");
  }
  const token = header.slice("Bearer ".length);
  const env = loadEnv();
  const { walletAddress } = await verifyAccessToken(token, env);
  request.user = { walletAddress };
}
