import { InMemoryNewsRepository } from "../repository/in-memory-repository.js";
import { InMemoryFundamentalEventStore } from "../fundamental/fundamental-data-service.js";
import { runFedIngestionJob } from "./jobs.js";

const newsRepository = new InMemoryNewsRepository();
const fundamentalEventStore = new InMemoryFundamentalEventStore();

const result = await runFedIngestionJob({ newsRepository, fundamentalEventStore });

console.log(JSON.stringify(result, null, 2));
if (result.error) process.exitCode = 1;
