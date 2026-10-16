import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { raise } from "niall-utils";

/** Where the downloaded databases are kept (gitignored, as they hold client data) */
export const DATABASES_DIR = "./timetracker_databases";

const DATABASE_NAME_RE = /^timetracker_\d{4}_\d{2}_\d{2}_auto_database\.db$/;

/** The most recent of the app's automatic backups, which have the date they were made in their names */
export const latestDatabase = (fileNames: string[]): string | undefined =>
  fileNames
    .filter(name => DATABASE_NAME_RE.test(name))
    .toSorted()
    .at(-1);

/** Copies the newest database in `driveDir` into `databasesDir`, replacing any copy of the same name. Returns its file name. */
export const fetchLatestDatabase = (
  driveDir: string,
  databasesDir: string
): string => {
  if (statSync(driveDir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    raise(
      new Error(
        `Drive folder not found: ${driveDir} (is Google Drive running?)`
      )
    );
  }
  const name =
    latestDatabase(readdirSync(driveDir)) ??
    raise(new Error(`No timetracker database found in ${driveDir}`));
  mkdirSync(databasesDir, { recursive: true });
  copyFileSync(join(driveDir, name), join(databasesDir, name));
  return name;
};
