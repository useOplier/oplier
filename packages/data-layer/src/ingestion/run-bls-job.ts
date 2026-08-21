// Standalone CLI entry point (package.json `ingest:bls`). Wires the job
// against a real repository (Drizzle, once available) — currently the
// in-memory repository, since no live DB exists in this build environment.
// Swap `InMemoryPriceRepository`/`InMemoryNewsRepository`/
// `InMemoryFundamentalEventStore` for the Drizzle-backed equivalents once
// `packages/db` is installable (see repository/drizzle-adapter.ts).
import { InMemoryNewsRepository } from "../repository/in-memory-repository.js";
import { InMemoryFundamentalEventStore } from "../fundamental/fundamental-data-service.js";
import { runBlsIngestionJob } from "./jobs.js";

const newsRepository = new InMemoryNewsRepository();
const fundamentalEventStore = new InMemoryFundamentalEventStore();

const result = await runBlsIngestionJob({
  newsRepository,
  fundamentalEventStore,
  blsApiKey: process.env.BLS_API_KEY,
});

console.log(JSON.stringify(result, null, 2));
if (result.error) process.exitCode = 1;
