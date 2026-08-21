import type { FastifyInstance } from "fastify";
import { users } from "@oplier/db";
import {
  nonceRequestSchema,
  nonceResponseSchema,
  verifyRequestSchema,
  verifyResponseSchema,
  refreshResponseSchema,
  ApiError,
} from "@oplier/shared-types";
import { issueNonce } from "./nonce-store.js";
import { verifySiweSignIn } from "./siwe.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt.js";
import { normalizeWalletAddress } from "../lib/address.js";
import { loadEnv } from "../config/env.js";

const REFRESH_COOKIE_NAME = "oplier_refresh";

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const env = loadEnv();

  /**
   * POST /auth/nonce — brief §1. Body only needs a wallet address so the response can be
   * shaped as a ready-to-sign SIWE message skeleton; the address itself isn't bound to the
   * nonce (SIWE binds identity via the signature over the full message, not the nonce alone).
   */
  fastify.post("/auth/nonce", async (request, reply) => {
    const body = nonceRequestSchema.parse(request.body);
    normalizeWalletAddress(body.walletAddress); // validates format; throws VALIDATION_ERROR if malformed

    const { nonce, expiresInSeconds } = issueNonce();
    const response = nonceResponseSchema.parse({
      nonce,
      domain: env.SIWE_DOMAIN,
      uri: env.SIWE_URI,
      expiresInSeconds,
    });
    reply.send(response);
  });

  /**
   * POST /auth/verify — brief §1. Verifies the signed SIWE message, upserts the `users` row
   * (first sign-in creates it — no separate "register" step, matching wallet-only auth), and
   * issues both tokens. Refresh token goes ONLY in an httpOnly cookie; access token is
   * returned in the body for the client to hold in memory.
   */
  fastify.post("/auth/verify", async (request, reply) => {
    const body = verifyRequestSchema.parse(request.body);
    const { walletAddress } = await verifySiweSignIn(body.message, body.signature, env);

    // First sign-in creates the users row — wallet-only auth has no separate "register" step.
    await fastify.db.insert(users).values({ walletAddress }).onConflictDoNothing();

    const access = await signAccessToken(walletAddress, env);
    const refresh = await signRefreshToken(walletAddress, env);

    reply.setCookie(REFRESH_COOKIE_NAME, refresh.token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/auth",
      maxAge: refresh.expiresInSeconds,
    });

    reply.send(
      verifyResponseSchema.parse({
        walletAddress,
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
      }),
    );
  });

  /** POST /auth/refresh — reads the httpOnly refresh cookie, issues a new access token. */
  fastify.post("/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      throw new ApiError("UNAUTHORIZED", "No refresh token present.");
    }
    const { walletAddress } = await verifyRefreshToken(refreshToken, env);
    const access = await signAccessToken(walletAddress, env);
    reply.send(
      refreshResponseSchema.parse({
        accessToken: access.token,
        expiresInSeconds: access.expiresInSeconds,
      }),
    );
  });

  /**
   * POST /auth/logout — clears the refresh cookie client-side. KNOWN LIMITATION (see jwt.ts):
   * since tokens are stateless with no revocation list, a refresh token already copied out of
   * the cookie by an attacker would remain valid until it expires. Acceptable for MVP; flagged.
   */
  fastify.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(REFRESH_COOKIE_NAME, { path: "/auth" });
    reply.status(204).send();
  });
}
