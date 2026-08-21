import { config } from "dotenv";
config();
import { z } from "zod";

/**
 * `config()` runs once, the first time this module is imported — before `loadEnv()` is ever
 * called by anything (plugins/db.ts, auth/*, app.ts, server.ts all import `loadEnv` from
 * here, never read `process.env` directly). `tsx` does NOT load `.env` files automatically,
 * unlike some other dev runners — this call is the fix for that, not a defensive extra.
 * Uses dotenv's main export (`import { config } from "dotenv"`) rather than the
 * `"dotenv/config"` side-effect subpath — the main export has a proper `"types"` condition
 * in dotenv's package.json exports map, the subpath doesn't, so this avoids relying on a
 * resolution edge case some tools handle inconsistently. It looks for `.env` in
 * `process.cwd()`, which `pnpm --filter @oplier/api run <script>` sets to `apps/api/` — see
 * apps/api/README.md for why that's the authoritative `.env` location for this package.
 *
 * Fails fast at startup rather than surfacing a confusing runtime error later. JWT secrets
 * must be at least 32 chars (HS256 minimum recommended key size).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  /** The domain SIWE messages must be scoped to (EIP-4361 `domain` field) — the frontend's origin host, no protocol. */
  SIWE_DOMAIN: z.string().min(1, "SIWE_DOMAIN is required"),
  /** The exact URI SIWE messages must reference (EIP-4361 `uri` field) — the frontend's origin. */
  SIWE_URI: z.string().url("SIWE_URI must be a full URL, e.g. https://app.oplier.xyz"),
  /** Comma-separated list of origins allowed to call this API (CORS). */
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  /**
   * Base URL this process uses to call its OWN REST endpoints, for the ApiClient
   * `packages/llm`'s `runConversationTurn` needs injected (LLM_CONTRACT.md §3: "an injected
   * ApiClient (Part B's REST endpoints)... with the current user's accessToken already
   * attached"). Defaults to a loopback address using this same process's own PORT — see
   * `ReferenceApiClient` in `packages/llm`, which is what modules/chats/
   * run-conversation-turn.adapter.ts actually injects.
   */
  INTERNAL_API_BASE_URL: z.string().url().optional(),
  /**
   * Optional — LLM_CONTRACT.md §6 is explicit that Tavily API key management is NOT Part G's
   * responsibility, and it isn't provisioned as part of this build either. When unset,
   * modules/chats/run-conversation-turn.adapter.ts falls back to a no-op TavilyClient instead
   * of failing the whole conversation turn over a missing search provider.
   */
  TAVILY_API_KEY: z.string().optional(),

  /**
   * X Layer RPC, used by GET /portfolio to read ERC-20 balances directly from chain.
   *
   * The API previously needed no chain access at all — portfolio was derived purely from the
   * `positions` table, which is why a wallet holding real tokens still reported $0. Reading balances
   * is the fix, and that needs an endpoint. Default matches the worker's primary
   * (`apps/worker/.env`); the second official OKX endpoint is deliberately NOT used as a fallback here
   * because it currently accepts connections and never responds.
   */
  XLAYER_RPC_URL: z.string().url().default("https://testrpc.xlayer.tech/terigon"),

  /**
   * One-off transaction execution (POST /transactions/:id/approve). The swap is submitted from
   * the backend-owned smart account — the same account and key hierarchy the worker uses for
   * System swaps (SMART_ACCOUNT_OWNER_PRIVATE_KEY owns it; Alchemy bundler relays). Both optional:
   * when unset, the approve endpoint fails with a clear EXECUTION_UNAVAILABLE error instead of
   * breaking API startup.
   */
  ALCHEMY_API_KEY: z.string().optional(),
  SMART_ACCOUNT_OWNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key")
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration — see above for details.");
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
