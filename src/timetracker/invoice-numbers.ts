import { readdirSync } from "node:fs";
import { join } from "node:path";
import { attempt, raise } from "niall-utils";

import { isFile, readText, writeText } from "../io.ts";

/** Gitignored: the invoice ids that have been used */
export const INVOICE_NUMBERS_FILE = "./.invoice-numbers.json";

export interface InvoiceNumbers {
  /** The last new invoice id that was allocated, which the next one continues from */
  last: string | undefined;
  /** The invoice id each draft raw invoice (by file name) was given */
  drafts: Record<string, string>;
}

const INVOICE_ID_PREFIX = "invoice_id=";

/** The digits an id ends with, e.g. `0041` for `AB0041` */
const trailingDigits = (id: string): string => {
  const reversed = id.split("").toReversed();
  const end = reversed.findIndex(char => char < "0" || char > "9");
  return reversed
    .slice(0, end === -1 ? reversed.length : end)
    .toReversed()
    .join("");
};

/** `AB0041` -> `AB0042`, keeping the prefix and the number of digits */
export const incrementInvoiceId = (id: string): string => {
  const digits = trailingDigits(id);
  if (digits === "") {
    raise(new Error(`Invoice id '${id}' does not end in a number`));
  }
  return `${id.slice(
    0,
    id.length - digits.length
  )}${String(Number(digits) + 1).padStart(digits.length, "0")}`;
};

const numberOf = (id: string): number => Number(trailingDigits(id));

/** The invoice id with the highest number in the raw invoices */
const highestInvoiceId = (rawInvoicesDir: string): string | undefined =>
  readdirSync(rawInvoicesDir)
    .filter(name => name.endsWith(".cfg"))
    .flatMap(name => readText(join(rawInvoicesDir, name)).split("\n"))
    .filter(line => line.startsWith(INVOICE_ID_PREFIX))
    .map(line => line.slice(INVOICE_ID_PREFIX.length).trim())
    .filter(id => trailingDigits(id) !== "")
    .toSorted((a, b) => numberOf(b) - numberOf(a))
    .at(0);

/**
 * The id the next new invoice continues from: the last one allocated, or the
 * highest one in the raw invoices if none has been allocated yet.
 */
export const lastInvoiceId = (
  last: string | undefined,
  rawInvoicesDir: string
): string =>
  last ??
  highestInvoiceId(rawInvoicesDir) ??
  raise(
    new Error(
      `No invoice ids found in ${rawInvoicesDir} to continue from, so say which one to use with --invoice-id`
    )
  );

const isStoredNumbers = (
  data: unknown
): data is { last?: string; drafts?: Record<string, string> } => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const last: unknown = Reflect.get(data, "last");
  const drafts: unknown = Reflect.get(data, "drafts");
  return (
    (last === undefined || typeof last === "string") &&
    (drafts === undefined ||
      (typeof drafts === "object" &&
        drafts !== null &&
        !Array.isArray(drafts) &&
        Object.values(drafts).every(id => typeof id === "string")))
  );
};

/** Nothing has been used if the file does not exist yet */
export const readInvoiceNumbers = (path: string): InvoiceNumbers => {
  if (!isFile(path)) return { last: undefined, drafts: {} };
  const data: unknown = attempt(() => JSON.parse(readText(path)) as unknown);
  if (!isStoredNumbers(data)) {
    raise(
      new Error(
        `${path} is not valid, expected {"last": "<id>", "drafts": {"<file name>": "<id>"}}`
      )
    );
  }
  return { last: data.last, drafts: data.drafts ?? {} };
};

export const writeInvoiceNumbers = (
  path: string,
  numbers: InvoiceNumbers
): void => {
  writeText(path, `${JSON.stringify(numbers, null, 2)}\n`);
};
