import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import { ZodError } from "zod";
import { ApiError, type ApiErrorBody } from "@oplier/shared-types";

/**
 * Single source of truth for turning a thrown error into the standard `ApiErrorBody` shape
 * (Part B brief §"Validation & error conventions"). Three cases:
 *  1. `ApiError` (thrown deliberately anywhere in route/service code) — serialized as-is.
 *  2. `ZodError` (a route forgot to catch a `.parse()` failure) — treated as VALIDATION_ERROR.
 *  3. Anything else — never leaks internals to the client; logged server-side, returned as an
 *     opaque INTERNAL_ERROR (doc 02: "Unsupported requests are not silently changed,
 *     approximated, or worked around" — the flip side is real bugs shouldn't be silently
 *     dressed up as something they're not, but they also must never leak stack traces/DB
 *     errors to an unauthenticated caller).
 */
export default fp(async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError | ApiError | ZodError | Error, request, reply) => {
    if (error instanceof ApiError) {
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      reply.status(error.status).send(body);
      return;
    }

    if (error instanceof ZodError) {
      const body: ApiErrorBody = {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten(),
        },
      };
      reply.status(422).send(body);
      return;
    }

    // Fastify's own validation errors (e.g. malformed JSON body) carry a `statusCode`.
    const fastifyErr = error as FastifyError;
    if (typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode < 500) {
      const body: ApiErrorBody = {
        error: { code: "VALIDATION_ERROR", message: error.message },
      };
      reply.status(fastifyErr.statusCode).send(body);
      return;
    }

    request.log.error(error, "Unhandled error");
    const body: ApiErrorBody = {
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    };
    reply.status(500).send(body);
  });

  fastify.setNotFoundHandler((_request, reply) => {
    const body: ApiErrorBody = {
      error: { code: "NOT_FOUND", message: "Route not found." },
    };
    reply.status(404).send(body);
  });
});
