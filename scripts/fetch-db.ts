// Process entry point: kept thin like generate.ts, as the scripts are not
// covered by the tests. Copies the newest timetracker database from Google
// Drive into timetracker_databases.
import { loadEnv, requireEnv } from "../src/env.ts";
import {
  DATABASES_DIR,
  fetchLatestDatabase,
} from "../src/timetracker/database-files.ts";

loadEnv();
const name = fetchLatestDatabase(
  requireEnv("TIMETRACKER_DRIVE_FOLDER"),
  DATABASES_DIR
);
console.log(`Copied ${name} to ${DATABASES_DIR}`);
