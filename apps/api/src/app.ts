import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { loadEnv } from "./config/env.js";
import dbPlugin from "./plugins/db.js";
import errorHandlerPlugin from "./plugins/error-handler.js";
import authPlugin from "./auth/auth-plugin.js";
import authRoutes from "./auth/routes.js";
import portfolioRoutes from "./modules/portfolio/routes.js";
import systemsRoutes from "./modules/systems/routes.js";
import positionsRoutes from "./modules/positions/routes.js";
import activityRoutes from "./modules/activity/routes.js";
import settingsRoutes from "./modules/settings/routes.js";
import newsRoutes from "./modules/news/routes.js";
import insightsRoutes from "./modules/insights/routes.js";
import transactionsRoutes from "./modules/transactions/routes.js";
import chatsRoutes from "./modules/chats/routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      // Never log secrets. Authorization headers and refresh-cookie values are redacted.
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
  });

  // Order matters: error handler + db + auth decoration first, so every route below can rely
  // on them; CORS/cookie next since they touch every request; route modules last.
  await app.register(errorHandlerPlugin);
  await app.register(dbPlugin);
  await app.register(authPlugin);

  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    credentials: true, // required for the httpOnly refresh cookie to be sent cross-origin
  });
  await app.register(cookie);

  await app.register(authRoutes);
  await app.register(portfolioRoutes);
  await app.register(systemsRoutes);
  await app.register(positionsRoutes);
  await app.register(activityRoutes);
  await app.register(settingsRoutes);
  await app.register(insightsRoutes);
  await app.register(newsRoutes);
  await app.register(transactionsRoutes);
  await app.register(chatsRoutes);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
