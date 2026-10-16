import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { raise } from "niall-utils";

export interface TimeEntry {
  client: string;
  project: string;
  /** Per hour */
  rate: number;
  /** `YYYY-MM-DD HH:MM` */
  start: string;
  minutes: number;
  notes: string;
}

export interface Expense {
  client: string;
  description: string;
  amount: number;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** The dates the month starts and the next month starts, as the app stores them */
const monthRange = (year: number, month: number): [string, string] => {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    raise(
      new Error(
        `Invalid month '${year}-${month}': expected a year and a month from 1 to 12`
      )
    );
  }
  return [
    `${year}-${pad2(month)}-01`,
    month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`,
  ];
};

const text = (value: SQLOutputValue | undefined): string =>
  typeof value === "string" ? value : "";

const num = (value: SQLOutputValue | undefined): number =>
  typeof value === "number"
    ? value
    : raise(
        new Error(
          `Expected a number in the database but found ${String(value)}`
        )
      );

/** The billable time worked in the month, oldest first */
export const readTimeEntries = (
  db: DatabaseSync,
  year: number,
  month: number
): TimeEntry[] => {
  const [from, to] = monthRange(year, month);
  return db
    .prepare(
      `select clientName, projectName, amountPerhour, date1, working, notes
       from TIMES
       where date1 >= ? and date1 < ? and coalesce(nonBillable, 0) = 0 and working > 0
       order by date1`
    )
    .all(from, to)
    .map(row => ({
      client: text(row["clientName"]),
      project: text(row["projectName"]),
      rate: num(row["amountPerhour"]),
      start: text(row["date1"]),
      minutes: num(row["working"]),
      notes: text(row["notes"]),
    }));
};

/** The billable expenses in the month, oldest first */
export const readExpenses = (
  db: DatabaseSync,
  year: number,
  month: number
): Expense[] => {
  const [from, to] = monthRange(year, month);
  return db
    .prepare(
      `select CLIENT.client as clientName, EXPENSE.categoryName, EXPENSE.notes, EXPENSE.amount
       from EXPENSE join CLIENT on CLIENT.rowid = EXPENSE.clientId
       where EXPENSE.expenseDate >= ? and EXPENSE.expenseDate < ? and coalesce(EXPENSE.nonBillable, 0) = 0
       order by EXPENSE.expenseDate, EXPENSE.rowid`
    )
    .all(from, to)
    .map(row => ({
      client: text(row["clientName"]),
      description: [text(row["categoryName"]), text(row["notes"])]
        .filter(part => part !== "")
        .join(" - "),
      amount: num(row["amount"]),
    }));
};
