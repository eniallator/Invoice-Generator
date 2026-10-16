import { describe, expect, it } from "vitest";

import {
  addClient,
  addExpense,
  addTime,
  createTimeDatabase,
} from "../test-helpers.ts";
import { readExpenses, readTimeEntries } from "./time-data.ts";

describe("readTimeEntries", () => {
  it("reads the entries in the month, oldest first", () => {
    const db = createTimeDatabase();
    addTime(db, {
      client: "Jane Roe",
      start: "2000-03-14 09:30",
      minutes: 120,
      project: "Website",
      rate: 40,
      notes: "Fix the header",
    });
    addTime(db, { client: "Jane Roe", start: "2000-03-02 10:00", minutes: 60 });

    expect(readTimeEntries(db, 2000, 3)).toEqual([
      {
        client: "Jane Roe",
        project: "Project",
        rate: 50,
        start: "2000-03-02 10:00",
        minutes: 60,
        notes: "",
      },
      {
        client: "Jane Roe",
        project: "Website",
        rate: 40,
        start: "2000-03-14 09:30",
        minutes: 120,
        notes: "Fix the header",
      },
    ]);
  });

  it("includes the whole of the month and nothing outside it", () => {
    const db = createTimeDatabase();
    for (const start of [
      "2000-02-29 23:59",
      "2000-03-01 00:00",
      "2000-03-31 23:59",
      "2000-04-01 00:00",
    ]) {
      addTime(db, { client: "Jane Roe", start, minutes: 60 });
    }
    expect(readTimeEntries(db, 2000, 3).map(entry => entry.start)).toEqual([
      "2000-03-01 00:00",
      "2000-03-31 23:59",
    ]);
  });

  it("rolls over into the next year for December", () => {
    const db = createTimeDatabase();
    for (const start of ["2000-12-31 12:00", "2001-01-01 00:00"]) {
      addTime(db, { client: "Jane Roe", start, minutes: 60 });
    }
    expect(readTimeEntries(db, 2000, 12).map(entry => entry.start)).toEqual([
      "2000-12-31 12:00",
    ]);
  });

  it("leaves out non billable time and time with nothing worked", () => {
    const db = createTimeDatabase();
    addTime(db, {
      client: "Jane Roe",
      start: "2000-03-01 10:00",
      minutes: 60,
      nonBillable: 1,
    });
    addTime(db, { client: "Jane Roe", start: "2000-03-02 10:00", minutes: 0 });
    addTime(db, {
      client: "Jane Roe",
      start: "2000-03-03 10:00",
      minutes: 60,
      nonBillable: 0,
    });
    addTime(db, {
      client: "Jane Roe",
      start: "2000-03-04 10:00",
      minutes: 60,
      nonBillable: null,
    });
    expect(readTimeEntries(db, 2000, 3).map(entry => entry.start)).toEqual([
      "2000-03-03 10:00",
      "2000-03-04 10:00",
    ]);
  });

  it("is empty for a month with no time", () => {
    expect(readTimeEntries(createTimeDatabase(), 2000, 3)).toEqual([]);
  });

  it("throws for a value that is not a number", () => {
    const db = createTimeDatabase();
    db.exec(
      "insert into TIMES (clientName, amountPerhour, date1, working) values ('Jane Roe', 'lots', '2000-03-01 10:00', 60)"
    );
    expect(() => readTimeEntries(db, 2000, 3)).toThrow(
      "Expected a number in the database but found lots"
    );
  });

  it.each([
    [2000, 0],
    [2000, 13],
    [2000, 1.5],
    [2000.5, 3],
    [Number.NaN, 3],
  ])("rejects the month %j-%j", (year, month) => {
    expect(() => readTimeEntries(createTimeDatabase(), year, month)).toThrow(
      "expected a year and a month from 1 to 12"
    );
  });
});

describe("readExpenses", () => {
  it("reads the expenses in the month with their client, oldest first", () => {
    const db = createTimeDatabase();
    const jane = addClient(db, "Jane Roe");
    const sam = addClient(db, "Sam Poe");
    addExpense(db, {
      clientId: sam,
      date: "2000-03-20",
      category: "Hosting",
      amount: 12.5,
    });
    addExpense(db, {
      clientId: jane,
      date: "2000-03-05",
      category: "Domain",
      amount: 9.99,
      notes: "Renewal",
    });
    addExpense(db, {
      clientId: jane,
      date: "2000-04-01",
      category: "Outside the month",
      amount: 1,
    });

    expect(readExpenses(db, 2000, 3)).toEqual([
      { client: "Jane Roe", description: "Domain - Renewal", amount: 9.99 },
      { client: "Sam Poe", description: "Hosting", amount: 12.5 },
    ]);
  });

  it("keeps expenses made on the same day in the order they were added", () => {
    const db = createTimeDatabase();
    const jane = addClient(db, "Jane Roe");
    for (const category of ["First", "Second", "Third"]) {
      addExpense(db, {
        clientId: jane,
        date: "2000-03-05",
        category,
        amount: 1,
      });
    }
    expect(readExpenses(db, 2000, 3).map(e => e.description)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("leaves out non billable expenses", () => {
    const db = createTimeDatabase();
    const jane = addClient(db, "Jane Roe");
    addExpense(db, {
      clientId: jane,
      date: "2000-03-05",
      category: "Mine",
      amount: 1,
      nonBillable: 1,
    });
    addExpense(db, {
      clientId: jane,
      date: "2000-03-05",
      category: "Billable",
      amount: 1,
      nonBillable: 0,
    });
    expect(readExpenses(db, 2000, 3).map(e => e.description)).toEqual([
      "Billable",
    ]);
  });

  it("leaves out expenses that have no client", () => {
    const db = createTimeDatabase();
    addExpense(db, {
      clientId: 99,
      date: "2000-03-05",
      category: "Orphan",
      amount: 1,
    });
    expect(readExpenses(db, 2000, 3)).toEqual([]);
  });

  it("describes an expense with no notes or category", () => {
    const db = createTimeDatabase();
    const jane = addClient(db, "Jane Roe");
    addExpense(db, {
      clientId: jane,
      date: "2000-03-05",
      category: "",
      amount: 1,
      notes: "Just notes",
    });
    expect(readExpenses(db, 2000, 3).map(e => e.description)).toEqual([
      "Just notes",
    ]);
  });

  it("rejects an invalid month", () => {
    expect(() => readExpenses(createTimeDatabase(), 2000, 13)).toThrow(
      "expected a year and a month from 1 to 12"
    );
  });
});
