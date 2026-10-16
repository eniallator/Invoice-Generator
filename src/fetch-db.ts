// Process entry point: kept thin (and excluded from coverage) like generate.ts.
// Copies the newest timetracker database from Google Drive into
// timetracker_databases.
import { loadEnv, requireEnv } from "./env.ts";
import {
  DATABASES_DIR,
  fetchLatestDatabase,
} from "./timetracker/database-files.ts";

loadEnv();
const name = fetchLatestDatabase(
  requireEnv("TIMETRACKER_DRIVE_FOLDER"),
  DATABASES_DIR
);
console.log(`Copied ${name} to ${DATABASES_DIR}`);
