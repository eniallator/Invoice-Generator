import { readdirSync } from "node:fs";
import { join } from "node:path";
import { raise } from "niall-utils";

import { Config } from "../config/config.ts";
import { META } from "../config/imports.ts";
import { isFile, writeText } from "../io.ts";
import {
  buildItems,
  renderDraft,
  type DraftExpense,
  type DraftItem,
} from "./invoice-draft.ts";
import {
  incrementInvoiceId,
  lastInvoiceId,
  readInvoiceNumbers,
  writeInvoiceNumbers,
} from "./invoice-numbers.ts";
import { parseThresholdMinutes } from "./rounding.ts";
import type { Expense, TimeEntry } from "./time-data.ts";

export interface DraftOptions {
  entries: TimeEntry[];
  expenses: Expense[];
  clientsDir: string;
  rawInvoicesDir: string;
  /** Where the invoice ids that have been used are kept */
  numbersPath: string;
  /** `YYYY-MM-DD` */
  today: string;
  /** What clients use unless their config sets `rounding_threshold_minutes` */
  thresholdMinutes: number;
  /** Only draft an invoice for this client (ignoring case and spacing) */
  client?: string;
  /** Use this invoice id (for a single client) instead of the next one */
  invoiceId?: string;
}

export type DraftResult =
  | {
      kind: "created";
      client: string;
      path: string;
      invoiceId: string;
      /** Where the id came from: asked for, recorded for this file earlier, or the next one */
      idSource: "given" | "recorded" | "new";
      hours: number;
      items: number;
      expenses: number;
    }
  | { kind: "skipped"; client: string; reason: string };

interface ClientConfig {
  /** The config file's name without the extension */
  file: string;
  /** What the client is called in the app, if that is not obvious from the file name */
  timetrackerName: string | undefined;
  defaultDescription: string | undefined;
  thresholdMinutes: number | undefined;
}

const normalise = (name: string): string =>
  name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

const readClients = (clientsDir: string): ClientConfig[] =>
  readdirSync(clientsDir)
    .filter(name => name.endsWith(".cfg"))
    .toSorted()
    .map(name => {
      const path = join(clientsDir, name);
      const config =
        Config.read(path) ??
        raise(new Error(`Could not read the client config ${path}`));
      const threshold = config.get(META, "rounding_threshold_minutes");
      return {
        file: name.slice(0, -".cfg".length),
        timetrackerName: config.get(META, "timetracker_client"),
        defaultDescription: config.get(META, "default_description"),
        thresholdMinutes:
          threshold === undefined
            ? undefined
            : parseThresholdMinutes(threshold),
      };
    });

/**
 * A client config matches an app client if it names it with `timetracker_client`
 * or its file name is the same ignoring case and spacing (`John Doe` and
 * `johnDoe.cfg`).
 */
const findClient = (
  clients: ClientConfig[],
  name: string
): ClientConfig | undefined =>
  clients.find(client => client.timetrackerName === name) ??
  clients.find(client => normalise(client.file) === normalise(name));

const skipped = (client: string, reason: string): DraftResult => ({
  kind: "skipped",
  client,
  reason,
});

/**
 * Writes a draft raw invoice for every client that has something to bill. It
 * never overwrites a file. A draft's invoice id is recorded against its file
 * name, so writing the same draft again reuses its id, and only a draft with a
 * new id moves on the last id that the next one continues from.
 */
export const createDrafts = (options: DraftOptions): DraftResult[] => {
  const clients = readClients(options.clientsDir);
  const wanted =
    options.client === undefined ? undefined : normalise(options.client);
  const names = [
    ...new Set([
      ...options.entries.map(entry => entry.client),
      ...options.expenses.map(expense => expense.client),
    ]),
  ]
    .filter(name => wanted === undefined || normalise(name) === wanted)
    .toSorted();
  if (options.invoiceId !== undefined && names.length > 1) {
    raise(
      new Error(
        `An invoice id is for a single invoice but ${
          names.length
        } clients have something to bill (${names.join(
          ", "
        )}), so choose one with --client`
      )
    );
  }
  const numbers = readInvoiceNumbers(options.numbersPath);

  return names.map(name => {
    const client = findClient(clients, name);
    if (client === undefined) {
      return skipped(
        name,
        `there is no matching config in ${
          options.clientsDir
        } (add one, or set timetracker_client=${name} in an existing one)`
      );
    }

    const items: DraftItem[] = buildItems(
      options.entries.filter(entry => entry.client === name),
      client.defaultDescription ?? "",
      client.thresholdMinutes ?? options.thresholdMinutes
    );
    const expenses: DraftExpense[] = options.expenses.filter(
      expense => expense.client === name
    );
    if (items.length === 0 && expenses.length === 0) {
      return skipped(name, "there is nothing to bill");
    }

    const draftName = `${client.file}.${options.today.replaceAll("-", ".")}.cfg`;
    const path = join(options.rawInvoicesDir, draftName);
    if (isFile(path)) return skipped(name, `${path} already exists`);

    const recorded = numbers.drafts[draftName];
    const [invoiceId, idSource] =
      options.invoiceId !== undefined
        ? ([options.invoiceId, "given"] as const)
        : recorded !== undefined
          ? ([recorded, "recorded"] as const)
          : ([
              incrementInvoiceId(
                lastInvoiceId(numbers.last, options.rawInvoicesDir)
              ),
              "new",
            ] as const);

    writeText(
      path,
      renderDraft({
        clientFile: client.file,
        invoiceId,
        invoiceDate: options.today.replaceAll("-", "/"),
        items,
        expenses,
      })
    );
    numbers.drafts[draftName] = invoiceId;
    if (idSource === "new") numbers.last = invoiceId;
    writeInvoiceNumbers(options.numbersPath, numbers);

    return {
      kind: "created",
      client: name,
      path,
      invoiceId,
      idSource,
      hours: items.reduce((total, item) => total + item.hours, 0),
      items: items.length,
      expenses: expenses.length,
    };
  });
};
