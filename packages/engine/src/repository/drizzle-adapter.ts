/**
 * Reference/production `SystemRepository` implementation against the real `packages/db`
 * (full_schema.txt). NOT exercised by this deliverable's test suite — there is no live
 * Postgres/Supabase connection in this build environment. Part I's first job with this file
 * should be running it against a real instance before trusting it, same caveat Part B raised
 * for its own work (API_CONTRACT.md §0).
 *
 * This file is intentionally NOT wired into `index.ts`'s barrel export and is not
 * typechecked as part of this package's `tsc --noEmit` run (see the package `tsconfig.json`
 * — it's excluded), because it imports `@oplier/db`, which doesn't exist as an installable
 * package in this sandbox. Keeping it present-but-excluded means Part I gets a concrete
 * starting point without this deliverable's CI (`pnpm typecheck`, `pnpm test`) failing on an
 * import it can't resolve. Delete the tsconfig exclusion once `@oplier/db` is a real
 * workspace dependency of this package.
 *
 * Key mapping notes:
 * - `createExecutionIfAbsent`: a single INSERT ... ON CONFLICT (system_id, run_id, step_id)
 *   DO NOTHING RETURNING *, using the real unique constraint name
 *   `executions_system_run_step_unique` (executions.ts). An empty RETURNING set means "lost
 *   the race" — return null, exactly as the interface contract requires. This is the actual
 *   atomic lock; no separate SELECT-then-INSERT anywhere in this file.
 * - `deleteSystem`: bare `db.delete(systems).where(eq(systems.id, systemId))` — re-verified
 *   in API_CONTRACT.md §4 that no application code is needed for the cascade/SET NULL
 *   behavior; Postgres enforces it from the FK constraints.
 * - Multi-step writes (`createSystemWithSteps`, `modifySystem`'s condition/swap replace)
 *   wrap in `db.transaction(async (tx) => { ... })` so a partial write can't leave orphaned
 *   `system_steps` rows with no matching `conditions`/`swaps`.
 */

// @ts-nocheck -- reference sketch only; see file header. Remove once @oplier/db is a real
// workspace dependency and this file is wired into the package's real build/typecheck.

// import { and, eq, sql } from "drizzle-orm";
// import {
//   conditions as conditionsTable,
//   db,
//   executions as executionsTable,
//   nexusPermissions,
//   positions as positionsTable,
//   swaps as swapsTable,
//   systemRuns,
//   systems as systemsTable,
//   systemSteps,
//   transactions as transactionsTable,
// } from "@oplier/db";
// import type { SystemRepository, StepBundle } from "./types.js";
//
// export class DrizzleSystemRepository implements SystemRepository {
//   async createExecutionIfAbsent(systemId: string, runId: string, stepId: string) {
//     const rows = await db
//       .insert(executionsTable)
//       .values({ systemId, runId, stepId, state: "WAITING", attemptCount: 0 })
//       .onConflictDoNothing({ target: [executionsTable.systemId, executionsTable.runId, executionsTable.stepId] })
//       .returning();
//     return rows[0] ?? null;
//   }
//
//   async deleteSystem(systemId: string) {
//     await db.delete(systemsTable).where(eq(systemsTable.id, systemId));
//   }
//
//   async createSystemWithSteps(system, stepsInput) {
//     return db.transaction(async (tx) => {
//       const [sys] = await tx.insert(systemsTable).values(system).returning();
//       const steps: StepBundle[] = [];
//       for (let i = 0; i < stepsInput.length; i++) {
//         const s = stepsInput[i];
//         const [step] = await tx
//           .insert(systemSteps)
//           .values({ systemId: sys.id, stepOrder: i + 1, groupOperator: s.groupOperator })
//           .returning();
//         const conditionRows = s.conditions.length
//           ? await tx
//               .insert(conditionsTable)
//               .values(s.conditions.map((c) => ({ stepId: step.id, conditionType: c.conditionType, parameters: c.parameters })))
//               .returning()
//           : [];
//         const [swap] = await tx
//           .insert(swapsTable)
//           .values({ ...s.swap, stepId: step.id, executionOrder: i + 1 })
//           .returning();
//         steps.push({ step, conditions: conditionRows, swap });
//       }
//       return { system: sys, steps };
//     });
//   }
//
//   // ... remaining methods follow the same direct-Drizzle-call pattern; omitted from this
//   // reference sketch for brevity. Each one is a straightforward select/update/insert
//   // against the table named in its method name — see `types.ts` for exact signatures and
//   // `in-memory-repository.ts` for the exact semantics each method must preserve (cascade/
//   // SET NULL behavior in particular, since the in-memory version deliberately mirrors it).
// }

export {};
