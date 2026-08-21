import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createDb, type Database } from "@oplier/db";
import { loadEnv } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database;
  }
}

/**
 * One `createDb()` client for the whole process, created once at startup and decorated onto
 * the Fastify instance (per @oplier/db's own doc: "Both apps/api and apps/worker ... call this
 * once at process startup ... rather than each process constructing its own client
 * independently"). `fastify-plugin` is used so the decoration is visible on the root instance,
 * not scoped to an encapsulated child context.
 */
export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  fastify.decorate("db", db);
});
