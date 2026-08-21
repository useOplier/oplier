import { InMemoryNewsRepository } from "../repository/in-memory-repository.js";
import { InMemoryFundamentalEventStore } from "../fundamental/fundamental-data-service.js";
import { runFredIngestionJob } from "./jobs.js";

const fredApiKey = process.env.FRED_API_KEY;
if (!fredApiKey) {
  console.error("FRED_API_KEY is required — see fred-client.ts file header for registration instructions.");
  process.exit(1);
}

const newsRepository = new InMemoryNewsRepository();
const fundamentalEventStore = new InMemoryFundamentalEventStore();

const result = await runFredIngestionJob({ newsRepository, fundamentalEventStore, fredApiKey });

console.log(JSON.stringify(result, null, 2));
if (result.error) process.exitCode = 1;
