import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach } from "vitest";

import { ContextVariables } from "./template/context-variables.ts";
import { DynamicContentParser } from "./template/dynamic-content-parser.ts";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export const lines = (...parts: string[]): string => parts.join("\n");

/** Writes the files (keyed by relative path) into a fresh temp dir and returns it */
export const createFiles = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-generator-"));
  createdDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return dir;
};

export const contextFrom = (
  cfg: string,
  files: Record<string, string> = {}
): ContextVariables =>
  new ContextVariables(
    join(createFiles({ "main.cfg": cfg, ...files }), "main.cfg")
  );

/** Renders `template` against `cfg` (as main.cfg), resolving file paths relative to the temp dir */
export const render = (
  template: string,
  cfg = "",
  files: Record<string, string> = {}
): string => {
  const dir = createFiles({ "main.cfg": cfg, ...files });
  return new DynamicContentParser(
    new ContextVariables(join(dir, "main.cfg")),
    dir
  ).parseString(template);
};

/** An empty in-memory database with just the parts of the timetracker app's tables that are read */
export const createTimeDatabase = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    create table CLIENT (client text);
    create table TIMES (clientName text, projectName text, amountPerhour float, date1 text, working integer, notes text, nonBillable integer);
    create table EXPENSE (categoryName text, amount float, notes text, expenseDate text, nonBillable integer, clientId integer);
  `);
  return db;
};

/** Returns the client's id */
export const addClient = (db: DatabaseSync, name: string): number =>
  Number(
    db.prepare("insert into CLIENT (client) values (?)").run(name)
      .lastInsertRowid
  );

export interface FakeTime {
  client: string;
  /** `YYYY-MM-DD HH:MM` */
  start: string;
  minutes: number;
  project?: string;
  rate?: number;
  notes?: string | null;
  nonBillable?: number | null;
}

export const addTime = (db: DatabaseSync, time: FakeTime): void => {
  db.prepare(
    "insert into TIMES (clientName, projectName, amountPerhour, date1, working, notes, nonBillable) values (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    time.client,
    time.project ?? "Project",
    time.rate ?? 50,
    time.start,
    time.minutes,
    time.notes ?? null,
    time.nonBillable ?? null
  );
};

export interface FakeExpense {
  clientId: number;
  /** `YYYY-MM-DD` */
  date: string;
  category: string;
  amount: number;
  notes?: string | null;
  nonBillable?: number | null;
}

export const addExpense = (db: DatabaseSync, expense: FakeExpense): void => {
  db.prepare(
    "insert into EXPENSE (categoryName, amount, notes, expenseDate, nonBillable, clientId) values (?, ?, ?, ?, ?, ?)"
  ).run(
    expense.category,
    expense.amount,
    expense.notes ?? null,
    expense.date,
    expense.nonBillable ?? null,
    expense.clientId
  );
};
