import { z } from "zod";

/**
 * POST /auth/nonce
 * Request: wallet address the client intends to sign with. Response: a one-time nonce plus
 * the exact SIWE message fields the client should use to build the message it asks the wallet
 * to sign, so the frontend never has to duplicate domain/URI/chainId logic.
 */
export const nonceRequestSchema = z.object({
  walletAddress: z.string().min(1),
});
export type NonceRequest = z.infer<typeof nonceRequestSchema>;

export const nonceResponseSchema = z.object({
  nonce: z.string(),
  domain: z.string(),
  uri: z.string(),
  /** Seconds until this nonce expires and can no longer be used to complete /auth/verify. */
  expiresInSeconds: z.number().int().positive(),
});
export type NonceResponse = z.infer<typeof nonceResponseSchema>;

/**
 * POST /auth/verify
 * Request: the full SIWE message text the wallet signed, plus the signature. The backend
 * re-derives every field (address, nonce, domain, etc.) from `message` itself via
 * `SiweMessage.verify()` rather than trusting separately-supplied fields.
 */
export const verifyRequestSchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

export const verifyResponseSchema = z.object({
  walletAddress: z.string(),
  accessToken: z.string(),
  /** Seconds until accessToken expires. Refresh token is set as an httpOnly cookie, not returned here. */
  expiresInSeconds: z.number().int().positive(),
});
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;

/** POST /auth/refresh — reads the refresh cookie, returns a new access token. */
export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
