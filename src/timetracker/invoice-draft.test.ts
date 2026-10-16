import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ContextVariables } from "../template/context-variables.ts";
import { createFiles, lines } from "../test-helpers.ts";
import { buildItems, itemId, renderDraft } from "./invoice-draft.ts";
import type { TimeEntry } from "./time-data.ts";

const entry = (
  start: string,
  minutes: number,
  overrides: Partial<TimeEntry> = {}
): TimeEntry => ({
  client: "Jane Roe",
  project: "Website",
  rate: 50,
  start,
  minutes,
  notes: "",
  ...overrides,
});

describe("itemId", () => {
  it.each([
    ["2000-03-01", " 1st Mar"],
    ["2000-03-02", " 2nd Mar"],
    ["2000-03-03", " 3rd Mar"],
    ["2000-03-04", " 4th Mar"],
    ["2000-03-09", " 9th Mar"],
    ["2000-03-10", "10th Mar"],
    ["2000-03-11", "11th Mar"],
    ["2000-03-12", "12th Mar"],
    ["2000-03-13", "13th Mar"],
    ["2000-03-14", "14th Mar"],
    ["2000-03-20", "20th Mar"],
    ["2000-03-21", "21st Mar"],
    ["2000-03-22", "22nd Mar"],
    ["2000-03-23", "23rd Mar"],
    ["2000-03-24", "24th Mar"],
    ["2000-03-30", "30th Mar"],
    ["2000-03-31", "31st Mar"],
  ])("%s is %j", (date, expected) => {
    expect(itemId(date)).toBe(expected);
  });

  it.each([
    ["01", "Jan"],
    ["02", "Feb"],
    ["03", "Mar"],
    ["04", "Apr"],
    ["05", "May"],
    ["06", "Jun"],
    ["07", "Jul"],
    ["08", "Aug"],
    ["09", "Sep"],
    ["10", "Oct"],
    ["11", "Nov"],
    ["12", "Dec"],
  ])("month %s is %s", (month, name) => {
    expect(itemId(`2000-${month}-15`)).toBe(`15th ${name}`);
  });

  it("adds the part", () => {
    expect(itemId("2000-03-01", 1)).toBe(" 1st Mar (pt 1)");
    expect(itemId("2000-03-31", 12)).toBe("31st Mar (pt 12)");
  });

  it("sorts alphabetically into day order for every day of the month", () => {
    const ids = Array.from({ length: 31 }, (_, index) =>
      itemId(`2000-03-${String(index + 1).padStart(2, "0")}`)
    );
    expect(ids.toSorted()).toEqual(ids);
  });

  it("sorts the parts of a day in order, before the next day", () => {
    const ids = [
      itemId("2000-03-09", 1),
      itemId("2000-03-09", 2),
      itemId("2000-03-10", 1),
      itemId("2000-03-10", 2),
    ];
    expect(ids.toSorted()).toEqual(ids);
  });
});

describe("buildItems", () => {
  it("makes an item for each day, with the rounded hours", () => {
    expect(
      buildItems(
        [
          entry("2000-03-01 09:00", 480),
          entry("2000-03-02 09:00", 420),
          entry("2000-03-10 09:00", 60),
        ],
        "Consulting",
        30
      )
    ).toEqual([
      { id: " 1st Mar", description: "Consulting", hours: 8, rate: 50 },
      { id: " 2nd Mar", description: "Consulting", hours: 7, rate: 50 },
      { id: "10th Mar", description: "Consulting", hours: 1, rate: 50 },
    ]);
  });

  it("rounds the hours across all of the days", () => {
    // 7h55 + 7h40 + 7h10 = 22h45, which rounds up to 23h
    expect(
      buildItems(
        [
          entry("2000-03-01 09:00", 475),
          entry("2000-03-02 09:00", 460),
          entry("2000-03-03 09:00", 430),
        ],
        "",
        30
      ).map(item => item.hours)
    ).toEqual([8, 8, 7]);
  });

  it("uses the threshold it is given", () => {
    const entries = [entry("2000-03-01 09:00", 430)];
    expect(buildItems(entries, "", 30)[0]?.hours).toBe(7);
    expect(buildItems(entries, "", 5)[0]?.hours).toBe(8);
  });

  it("adds up several sessions on the same day for the same project and rate", () => {
    expect(
      buildItems(
        [entry("2000-03-01 09:00", 240), entry("2000-03-01 14:00", 240)],
        "",
        30
      )
    ).toEqual([{ id: " 1st Mar", description: "", hours: 8, rate: 50 }]);
  });

  it("keeps different projects on the same day as separate parts, in the order they started", () => {
    const items = buildItems(
      [
        entry("2000-03-01 13:00", 180, { project: "Backend" }),
        entry("2000-03-01 09:00", 120, { project: "Website" }),
        entry("2000-03-02 09:00", 60),
      ],
      "",
      30
    );
    expect(items.map(({ id, hours }) => [id, hours])).toEqual([
      [" 1st Mar (pt 1)", 2],
      [" 1st Mar (pt 2)", 3],
      [" 2nd Mar", 1],
    ]);
  });

  it("keeps different rates on the same day as separate parts", () => {
    const items = buildItems(
      [
        entry("2000-03-01 09:00", 120, { rate: 40 }),
        entry("2000-03-01 11:00", 120, { rate: 60 }),
      ],
      "",
      30
    );
    expect(items.map(({ id, hours, rate }) => [id, hours, rate])).toEqual([
      [" 1st Mar (pt 1)", 2, 40],
      [" 1st Mar (pt 2)", 2, 60],
    ]);
  });

  it("sorts the entries by when they started", () => {
    const items = buildItems(
      [entry("2000-03-02 09:00", 60), entry("2000-03-01 09:00", 120)],
      "",
      30
    );
    expect(items.map(item => item.id)).toEqual([" 1st Mar", " 2nd Mar"]);
  });

  it("leaves out items that round down to no hours", () => {
    // 3 x 20 minutes is 1h, so only one day gets it (the last, as they are tied)
    expect(
      buildItems(
        [
          entry("2000-03-01 09:00", 20),
          entry("2000-03-02 09:00", 20),
          entry("2000-03-03 09:00", 20),
        ],
        "",
        30
      ).map(({ id, hours }) => [id, hours])
    ).toEqual([[" 3rd Mar", 1]]);
  });

  it("only numbers the parts that are left after leaving out the empty ones", () => {
    // 20 + 40 minutes is 1h, which goes to the 40 minute part
    expect(
      buildItems(
        [
          entry("2000-03-01 09:00", 20, { project: "Backend" }),
          entry("2000-03-01 10:00", 40, { project: "Website" }),
        ],
        "",
        30
      ).map(({ id, hours }) => [id, hours])
    ).toEqual([[" 1st Mar", 1]]);
  });

  it("describes an item with its notes, or the default description", () => {
    const items = buildItems(
      [
        entry("2000-03-01 09:00", 60, { notes: "Fix the header" }),
        entry("2000-03-02 09:00", 60),
        entry("2000-03-03 09:00", 60, { notes: "" }),
      ],
      "Consulting",
      30
    );
    expect(items.map(item => item.description)).toEqual([
      "Fix the header",
      "Consulting",
      "Consulting",
    ]);
  });

  it("joins the different notes in a day, and only once each", () => {
    const [item] = buildItems(
      [
        entry("2000-03-01 09:00", 60, { notes: "Fix the header" }),
        entry("2000-03-01 10:00", 60, { notes: "Add tests" }),
        entry("2000-03-01 11:00", 60, { notes: "Fix the header" }),
        entry("2000-03-01 12:00", 60),
      ],
      "Consulting",
      30
    );
    expect(item?.description).toBe("Fix the header, Add tests");
  });

  it("has no items without entries", () => {
    expect(buildItems([], "Consulting", 30)).toEqual([]);
  });

  it("does not change the entries it is given", () => {
    const entries = [
      entry("2000-03-02 09:00", 60),
      entry("2000-03-01 09:00", 120),
    ];
    buildItems(entries, "", 30);
    expect(entries.map(e => e.start)).toEqual([
      "2000-03-02 09:00",
      "2000-03-01 09:00",
    ]);
  });
});

describe("renderDraft", () => {
  const draft = {
    clientFile: "janeRoe",
    invoiceId: "AB0042",
    invoiceDate: "2000/03/15",
    items: [
      { id: " 1st Mar", description: "Consulting", hours: 8, rate: 50 },
      { id: "10th Mar", description: "Consulting", hours: 7, rate: 52.5 },
    ],
    expenses: [{ description: "Domain - Renewal", amount: 9.99 }],
  };

  it("writes the raw invoice", () => {
    expect(renderDraft(draft)).toBe(
      lines(
        "[META]",
        "",
        "import=./default",
        "    ../clients/janeRoe",
        "invoice_id=AB0042",
        "invoice_date=2000/03/15",
        "",
        "[ITEM_ 1st Mar]",
        "",
        "description=Consulting",
        "hrs=8",
        "rate=50",
        "",
        "[ITEM_10th Mar]",
        "",
        "description=Consulting",
        "hrs=7",
        "rate=52.5",
        "",
        "[EXPENSE_1]",
        "",
        "description=Domain - Renewal",
        "qty=1",
        "price=9.99",
        ""
      )
    );
  });

  it("has just the header without any items or expenses", () => {
    expect(renderDraft({ ...draft, items: [], expenses: [] })).toBe(
      lines(
        "[META]",
        "",
        "import=./default",
        "    ../clients/janeRoe",
        "invoice_id=AB0042",
        "invoice_date=2000/03/15",
        ""
      )
    );
  });

  it("shows expenses to two decimal places", () => {
    const result = renderDraft({
      ...draft,
      items: [],
      expenses: [
        { description: "Hosting", amount: 20 },
        { description: "Fee", amount: 19.200000762939453 },
      ],
    });
    expect(result).toContain("price=20.00");
    expect(result).toContain("price=19.20");
  });

  it("numbers the expenses so that they sort in order", () => {
    const expenses = Array.from({ length: 10 }, (_, index) => ({
      description: `Expense ${index + 1}`,
      amount: 1,
    }));
    const result = renderDraft({ ...draft, items: [], expenses });
    expect(result).toContain("[EXPENSE_01]");
    expect(result).toContain("[EXPENSE_10]");
    expect(result).not.toContain("[EXPENSE_1]");
    expect(renderDraft({ ...draft, items: [] })).toContain("[EXPENSE_1]");
  });

  it("keeps descriptions to one line", () => {
    const result = renderDraft({
      ...draft,
      items: [
        {
          id: " 1st Mar",
          description: "Line one\n  line two",
          hours: 1,
          rate: 1,
        },
      ],
      expenses: [{ description: "Tab\tand\nnewline ", amount: 1 }],
    });
    expect(result).toContain("description=Line one line two\n");
    expect(result).toContain("description=Tab and newline\n");
  });

  describe("read back by the generator", () => {
    const ids = [
      "2000-03-01",
      "2000-03-02",
      "2000-03-09",
      "2000-03-10",
      "2000-03-11",
      "2000-03-21",
      "2000-03-22",
      "2000-03-31",
    ].map(date => itemId(date));

    const read = () => {
      const dir = createFiles({
        "raw/default.cfg": "[META]\ninvoice_terms=7 days\n",
        "clients/janeRoe.cfg": "[INVOICE_TO]\nfullname=Jane Roe\n",
        "raw/draft.cfg": renderDraft({
          ...draft,
          items: ids.toReversed().map(id => ({
            id,
            description: `Work on ${id.trim()}`,
            hours: 2,
            rate: 50,
          })),
        }),
      });
      return new ContextVariables(join(dir, "raw", "draft.cfg"));
    };

    it("keeps the leading space in the ids", () => {
      expect(
        read()
          .calculateItems("ITEM")
          .map(item => item.get("id"))
      ).toEqual(ids);
      expect(ids[0]).toBe(" 1st Mar");
    });

    it("lists the items in day order", () => {
      expect(
        read()
          .calculateItems("ITEM")
          .map(item => item.get("description"))
      ).toEqual(ids.map(id => `Work on ${id.trim()}`));
    });

    it("works out the totals", () => {
      const context = read();
      expect(context.getVariable("ITEM_total_due")).toBe("800.00");
      expect(context.getVariable("invoice_id")).toBe("AB0042");
      expect(context.getVariable("invoice_terms")).toBe("7 days");
    });
  });
});
