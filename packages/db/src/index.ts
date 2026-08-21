import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Holds the underlying `postgres` client for a drizzle instance so callers can actually close the
 * pool. Drizzle does not expose its client, and `postgres()` opens a pool of up to 10 connections by
 * default, so without this there is no way to release one — every extra `createDb` call leaks its
 * pool for the lifetime of the process.
 *
 * That was a real fault, not a hypothetical: `apps/worker/src/preflight.ts` called `createDb` for its
 * schema checks while `runtime.ts` had already created one, so each worker start held two pools and
 * only ever used one. Against Supabase's pgbouncer pooler — which caps *client* connections well
 * below what several processes each opening 10 can consume — a systemd restart loop plus the API's
 * own pool is enough to exhaust it, at which point every query hangs rather than failing. Observed
 * exactly that: the engine and the activation reconciler both stalled mid-cycle with no error logged,
 * because a hung acquire never rejects.
 */
const clientByDb = new WeakMap<object, ReturnType<typeof postgres>>();

/**
 * Shared DB client factory. Both `apps/api` and `apps/worker` import from `@oplier/db`
 * and call this once at process startup with their own `DATABASE_URL`, rather than each
 * process constructing its own client independently — keeps pool config in one place.
 *
 * Call it ONCE per process and pass the result around. If you genuinely need a second, short-lived
 * instance, pair it with `closeDb` in a `finally`.
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client, { schema });
  clientByDb.set(db, client);
  return db;
}

/**
 * Closes the connection pool behind a `createDb` result. Safe to call on an already-closed or
 * unknown instance (no-op), so shutdown paths do not need to track whether they own the pool.
 */
export async function closeDb(db: object): Promise<void> {
  const client = clientByDb.get(db);
  if (!client) return;
  clientByDb.delete(db);
  await client.end({ timeout: 5 });
}

export type Database = ReturnType<typeof createDb>;

export * from "./schema";
