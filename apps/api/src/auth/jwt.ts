import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { ApiError } from "@oplier/shared-types";
import type { Env } from "../config/env.js";

/**
 * Session strategy (Part A brief left this as "your call, document the choice" —
 * documented here and in API_CONTRACT.md):
 *  - Short-lived access token (15 min), returned in the /auth/verify response body, sent by
 *    the client as `Authorization: Bearer <token>`.
 *  - Longer-lived refresh token (30 days), set as an httpOnly, Secure, SameSite=Strict cookie
 *    — never exposed to frontend JS, so an XSS can't exfiltrate it.
 *  - Both are stateless signed JWTs, NOT tracked in the database. KNOWN MVP LIMITATION: there
 *    is no revocation list, so POST /auth/logout can only clear the cookie client-side — a
 *    refresh token issued before logout remains cryptographically valid until it expires.
 *    Acceptable for a hackathon MVP; flagged because a production version should add a
 *    revocation table (which would mean asking Part A to extend the schema).
 */

const ACCESS_TOKEN_TTL = "15m";
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL = "30d";
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

interface TokenPayload {
  walletAddress: string;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(
  walletAddress: string,
  env: Env,
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = await new SignJWT({ walletAddress } satisfies TokenPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secretKey(env.JWT_ACCESS_SECRET));
  return { token, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
}

export async function signRefreshToken(
  walletAddress: string,
  env: Env,
): Promise<{ token: string; expiresInSeconds: number }> {
  const token = await new SignJWT({ walletAddress } satisfies TokenPayload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(secretKey(env.JWT_REFRESH_SECRET));
  return { token, expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS };
}

async function verifyToken(token: string, secret: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (typeof payload.walletAddress !== "string") {
      throw new ApiError("UNAUTHORIZED", "Malformed token payload.");
    }
    return { walletAddress: payload.walletAddress };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new ApiError("UNAUTHORIZED", "Token expired.");
    }
    throw new ApiError("UNAUTHORIZED", "Invalid token.");
  }
}

export function verifyAccessToken(token: string, env: Env): Promise<TokenPayload> {
  return verifyToken(token, env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token: string, env: Env): Promise<TokenPayload> {
  return verifyToken(token, env.JWT_REFRESH_SECRET);
}
