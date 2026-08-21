// EDGAR is on-demand/per-ticker (see edgar-client.ts), not a scheduled
// calendar job like the other three — this entry point is a smoke-test CLI
// for manually confirming the integration once network access exists, not a
// cron target. `apps/api`/`apps/worker` should call
// `FundamentalDataService.getRelevantFilings(ticker)` directly instead of
// shelling out to this script.
import { EdgarClient } from "../fundamental/edgar-client.js";

const ticker = process.argv[2];
if (!ticker) {
  console.error("Usage: tsx src/ingestion/run-edgar-job.ts <TICKER>");
  process.exit(1);
}

const userAgent = process.env.SEC_EDGAR_USER_AGENT;
if (!userAgent) {
  console.error(
    "SEC_EDGAR_USER_AGENT is required (e.g. 'Oplier contact@oplier.example') — see edgar-client.ts file header.",
  );
  process.exit(1);
}

const client = new EdgarClient({ userAgent });
const filings = await client.getRelevantFilings(ticker);
console.log(JSON.stringify(filings, null, 2));
