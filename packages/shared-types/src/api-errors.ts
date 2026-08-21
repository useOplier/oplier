import { z } from "zod";

/**
 * Standard error shape across the API (Part B brief §"Validation & error conventions" —
 * "pick one, document it"). Every non-2xx response body matches this exactly.
 *
 * `code` is a stable, machine-readable string the frontend and LLM tool layer can switch on
 * without parsing `message` (which is human-readable and may change wording over time).
 */
export const apiErrorCodeSchema = z.enum([
  "UNAUTHORIZED", // missing/invalid/expired session
  "FORBIDDEN", // authenticated, but not allowed to act on this resource
  "NOT_FOUND",
  "VALIDATION_ERROR", // request body/params failed Zod validation
  "UNSUPPORTED_CAPABILITY", // doc 02: "Unsupported requests are not silently changed, approximated, or worked around"
  "UNSUPPORTED_ASSET", // doc 01 §8
  "CONFLICT", // e.g. duplicate nonce use, state transition not legal from current status
  "RATE_LIMITED",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorBodySchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Optional structured detail — e.g. Zod's flattened issue list for VALIDATION_ERROR. */
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  UNSUPPORTED_CAPABILITY: 422,
  UNSUPPORTED_ASSET: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/**
 * Thrown anywhere in apps/api's route/service layer; the central error handler
 * (plugins/error-handler.ts) catches this specifically and serializes it to `ApiErrorBody`
 * with the matching HTTP status. Anything else that reaches the handler is treated as an
 * unclassified INTERNAL_ERROR and never leaks its raw message to the client.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
