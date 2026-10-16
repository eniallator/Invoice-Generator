import { zip } from "niall-utils";

import { formatFixed2 } from "../numbers.ts";
import { roundHours } from "./rounding.ts";
import type { TimeEntry } from "./time-data.ts";

export interface DraftItem {
  /** What follows `ITEM_` in the section name */
  id: string;
  description: string;
  hours: number;
  rate: number;
}

export interface DraftExpense {
  description: string;
  amount: number;
}

const ORDINAL_RULES = new Intl.PluralRules("en-US", { type: "ordinal" });
const ORDINAL_SUFFIXES: Record<Intl.LDMLPluralRule, string> = {
  zero: "th",
  one: "st",
  two: "nd",
  few: "rd",
  many: "th",
  other: "th",
};

/**
 * The item id for a day, e.g. ` 1st Sep` (and ` 1st Sep (pt 2)` for the second
 * item that day). Single digit days have a leading space, so that sorting the
 * ids alphabetically (which is how items are ordered) puts them in day order.
 */
export const itemId = (date: string, part?: number): string => {
  const day = Number(date.slice(8, 10));
  const suffix = ORDINAL_SUFFIXES[ORDINAL_RULES.select(day)];
  const month = new Date(
    Date.UTC(2000, Number(date.slice(5, 7)) - 1)
  ).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const label = `${String(day).padStart(2, " ")}${suffix} ${month}`;
  return part === undefined ? label : `${label} (pt ${part})`;
};

interface Unit {
  date: string;
  rate: number;
  minutes: number;
  notes: string[];
}

/**
 * One item for each project and rate worked on each day, with the hours rounded
 * (see `roundHours`) across all of them. Items with no hours are left out.
 * Several items in a day are numbered in the order they were started.
 */
export const buildItems = (
  entries: TimeEntry[],
  defaultDescription: string,
  thresholdMinutes: number
): DraftItem[] => {
  const units = new Map<string, Unit>();
  for (const entry of entries.toSorted((a, b) =>
    a.start.localeCompare(b.start)
  )) {
    const date = entry.start.slice(0, 10);
    const key = [date, entry.project, entry.rate].join("\0");
    const unit = units.get(key) ?? {
      date,
      rate: entry.rate,
      minutes: 0,
      notes: [],
    };
    unit.minutes += entry.minutes;
    if (entry.notes !== "" && !unit.notes.includes(entry.notes)) {
      unit.notes.push(entry.notes);
    }
    units.set(key, unit);
  }

  const all = [...units.values()];
  const hours = roundHours(
    all.map(unit => unit.minutes),
    thresholdMinutes
  );
  const billed = zip(all, hours).flatMap(([unit, unitHours]) =>
    unitHours > 0 ? [{ unit, hours: unitHours }] : []
  );

  const perDay = new Map<string, number>();
  for (const { unit } of billed) {
    perDay.set(unit.date, (perDay.get(unit.date) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return billed.map(({ unit, hours: unitHours }) => {
    const part = (seen.get(unit.date) ?? 0) + 1;
    seen.set(unit.date, part);
    return {
      id: itemId(unit.date, perDay.get(unit.date) === 1 ? undefined : part),
      description:
        unit.notes.length > 0 ? unit.notes.join(", ") : defaultDescription,
      hours: unitHours,
      rate: unit.rate,
    };
  });
};

// Descriptions are a single line in the config
const oneLine = (value: string): string => value.replaceAll(/\s+/g, " ").trim();

export const renderDraft = (draft: {
  clientFile: string;
  invoiceId: string;
  /** `YYYY/MM/DD` */
  invoiceDate: string;
  items: DraftItem[];
  expenses: DraftExpense[];
}): string => {
  const width = String(draft.expenses.length).length;
  return [
    [
      "[META]",
      "",
      "import=./default",
      `    ../clients/${draft.clientFile}`,
      `invoice_id=${draft.invoiceId}`,
      `invoice_date=${draft.invoiceDate}`,
      "",
    ].join("\n"),
    ...draft.items.map(item =>
      [
        `[ITEM_${item.id}]`,
        "",
        `description=${oneLine(item.description)}`,
        `hrs=${item.hours}`,
        `rate=${item.rate}`,
        "",
      ].join("\n")
    ),
    ...draft.expenses.map((expense, index) =>
      [
        `[EXPENSE_${String(index + 1).padStart(width, "0")}]`,
        "",
        `description=${oneLine(expense.description)}`,
        "qty=1",
        `price=${formatFixed2(expense.amount)}`,
        "",
      ].join("\n")
    ),
  ].join("\n");
};
