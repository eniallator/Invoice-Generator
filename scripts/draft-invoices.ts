// Process entry point: kept thin like generate.ts, as the scripts are not
// covered by the tests. Writes a draft raw invoice for each client with time in
// the given month, from the newest database in timetracker_databases.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { formatLocaleDate, raise } from "niall-utils";

import { loadEnv, requireEnv } from "../src/env.ts";
import {
  DATABASES_DIR,
  latestDatabase,
} from "../src/timetracker/database-files.ts";
import { createDrafts } from "../src/timetracker/drafts.ts";
import { INVOICE_NUMBERS_FILE } from "../src/timetracker/invoice-numbers.ts";
import { parseThresholdMinutes } from "../src/timetracker/rounding.ts";
import { readExpenses, readTimeEntries } from "../src/timetracker/time-data.ts";

const USAGE = `Usage: pnpm draft-invoices <year> <month> [options]

Write a draft raw invoice for every client with time in the month. Existing
drafts are never overwritten, and drafting the same file again reuses its
invoice id.

Options:
  --client <name>      Only draft this client's invoice
  --invoice-id <id>    Use this invoice id instead of the next one (for a single
                       client, so it needs --client if several have time)
  --db <path>          Database to use (default: the newest in ${DATABASES_DIR})`;

loadEnv();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    client: { type: "string" },
    "invoice-id": { type: "string" },
    db: { type: "string" },
  },
});
const [year, month, ...extra] = positionals.map(Number);
if (year === undefined || month === undefined || extra.length > 0) {
  console.log(USAGE);
  process.exit(2);
}

const databasePath =
  values.db ??
  join(
    DATABASES_DIR,
    latestDatabase(readdirSync(DATABASES_DIR)) ??
      raise(
        new Error(`No database in ${DATABASES_DIR}, run pnpm fetch-db first`)
      )
  );
const db = new DatabaseSync(databasePath, { readOnly: true });

const results = createDrafts({
  entries: readTimeEntries(db, year, month),
  expenses: readExpenses(db, year, month),
  clientsDir: "./clients",
  rawInvoicesDir: "./raw_invoices",
  numbersPath: INVOICE_NUMBERS_FILE,
  // The date part of YYYY-MM-DDTHH:mm:ss, in local time
  today: (
    formatLocaleDate(new Date()) ??
    raise(new Error("Could not work out today's date"))
  ).slice(0, 10),
  thresholdMinutes: parseThresholdMinutes(
    requireEnv("ROUNDING_THRESHOLD_MINUTES")
  ),
  ...(values.client === undefined ? {} : { client: values.client }),
  ...(values["invoice-id"] === undefined
    ? {}
    : { invoiceId: values["invoice-id"] }),
});

if (results.length === 0) console.log("Nothing to draft");
for (const result of results) {
  console.log(
    result.kind === "created"
      ? `${result.client}: wrote ${result.path} (${result.invoiceId}${
          result.idSource === "new" ? "" : `, ${result.idSource}`
        }, ${result.hours} hrs in ${result.items} items, ${result.expenses} expenses)`
      : `${result.client}: skipped, ${result.reason}`
  );
}
