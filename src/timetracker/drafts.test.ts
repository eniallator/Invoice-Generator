import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { renderTemplate } from "../build.ts";
import { isFile, readText } from "../io.ts";
import {
  addClient,
  addExpense,
  addTime,
  createFiles,
  createTimeDatabase,
  lines,
} from "../test-helpers.ts";
import { createDrafts, type DraftOptions } from "./drafts.ts";
import { readInvoiceNumbers } from "./invoice-numbers.ts";
import {
  readExpenses,
  readTimeEntries,
  type Expense,
  type TimeEntry,
} from "./time-data.ts";

const NUMBERS = ".invoice-numbers.json";
const JANE_DRAFT = "janeRoe.2000.04.03.cfg";
const SAM_DRAFT = "samPoe.2000.04.03.cfg";

const entry = (
  client: string,
  start: string,
  minutes: number,
  overrides: Partial<TimeEntry> = {}
): TimeEntry => ({
  client,
  project: "Website",
  rate: 50,
  start,
  minutes,
  notes: "",
  ...overrides,
});

const CLIENTS = {
  "clients/janeRoe.cfg": lines(
    "[META]",
    "default_description=Consulting",
    "",
    "[INVOICE_TO]",
    "fullname=Jane Roe"
  ),
  "clients/samPoe.cfg": lines(
    "[META]",
    "timetracker_client=Sam P.",
    "",
    "[INVOICE_TO]",
    "fullname=Sam Poe"
  ),
  "raw/default.cfg": "[META]\ninvoice_terms=7 days\n",
  "raw/earlier.cfg": "[META]\ninvoice_id=AB0041\n",
};

const setup = (
  files: Record<string, string> = {},
  overrides: Partial<DraftOptions> = {}
) => {
  const dir = createFiles({ ...CLIENTS, ...files });
  const options: DraftOptions = {
    entries: [],
    expenses: [],
    clientsDir: join(dir, "clients"),
    rawInvoicesDir: join(dir, "raw"),
    numbersPath: join(dir, NUMBERS),
    today: "2000-04-03",
    thresholdMinutes: 30,
    ...overrides,
  };
  return {
    dir,
    options,
    run: (changes: Partial<DraftOptions> = {}) =>
      createDrafts({ ...options, ...changes }),
    numbers: () => readInvoiceNumbers(join(dir, NUMBERS)),
    draft: (name: string) => readText(join(dir, "raw", name)),
    hasDraft: (name: string) => isFile(join(dir, "raw", name)),
    deleteDraft: (name: string) => {
      rmSync(join(dir, "raw", name));
    },
  };
};

const JANE_MARCH = [
  entry("Jane Roe", "2000-03-01 09:00", 480),
  entry("Jane Roe", "2000-03-02 09:00", 420),
];
const SAM_MARCH = [entry("Sam P.", "2000-03-05 09:00", 60)];

describe("createDrafts", () => {
  it("writes a draft raw invoice for a client", () => {
    const { dir, run, draft } = setup({}, { entries: JANE_MARCH });

    expect(run()).toEqual([
      {
        kind: "created",
        client: "Jane Roe",
        path: join(dir, "raw", JANE_DRAFT),
        invoiceId: "AB0042",
        idSource: "new",
        hours: 15,
        items: 2,
        expenses: 0,
      },
    ]);
    expect(draft(JANE_DRAFT)).toBe(
      lines(
        "[META]",
        "",
        "import=./default",
        "    ../clients/janeRoe",
        "invoice_id=AB0042",
        "invoice_date=2000/04/03",
        "",
        "[ITEM_ 1st Mar]",
        "",
        "description=Consulting",
        "hrs=8",
        "rate=50",
        "",
        "[ITEM_ 2nd Mar]",
        "",
        "description=Consulting",
        "hrs=7",
        "rate=50",
        ""
      )
    );
  });

  it("includes the client's expenses", () => {
    const { run, draft } = setup(
      {},
      {
        entries: JANE_MARCH,
        expenses: [
          { client: "Jane Roe", description: "Domain", amount: 9.99 },
          { client: "Sam Poe", description: "Other client", amount: 5 },
        ],
      }
    );
    // The other client's expense gets a draft of its own
    expect(run()).toMatchObject([
      { kind: "created", client: "Jane Roe", items: 2, expenses: 1 },
      { kind: "created", client: "Sam Poe", items: 0, expenses: 1 },
    ]);
    expect(draft(JANE_DRAFT)).toContain(
      "[EXPENSE_1]\n\ndescription=Domain\nqty=1\nprice=9.99"
    );
    expect(draft(JANE_DRAFT)).not.toContain("Other client");
  });

  it("writes a draft for a client with only expenses", () => {
    const expenses: Expense[] = [
      { client: "Jane Roe", description: "Domain", amount: 9.99 },
    ];
    const { run } = setup({}, { expenses });
    expect(run()).toMatchObject([
      { kind: "created", hours: 0, items: 0, expenses: 1 },
    ]);
  });

  describe("invoice numbers", () => {
    it("continues from the highest id in the raw invoices", () => {
      const { run } = setup({}, { entries: JANE_MARCH });
      expect(run()).toMatchObject([{ invoiceId: "AB0042", idSource: "new" }]);
    });

    it("continues from the last id that was allocated, if there is one", () => {
      const { run, numbers } = setup(
        { [NUMBERS]: JSON.stringify({ last: "AB0100" }) },
        { entries: JANE_MARCH }
      );
      expect(run()).toMatchObject([{ invoiceId: "AB0101" }]);
      expect(numbers().last).toBe("AB0101");
    });

    it("records the id against the draft's file name", () => {
      const { run, numbers } = setup({}, { entries: JANE_MARCH });
      run();
      expect(numbers()).toEqual({
        last: "AB0042",
        drafts: { [JANE_DRAFT]: "AB0042" },
      });
    });

    it("gives each client's draft the next number, in client order", () => {
      const { run, numbers } = setup(
        {},
        {
          entries: [
            entry("Sam P.", "2000-03-05 09:00", 60),
            entry("Jane Roe", "2000-03-01 09:00", 60),
          ],
        }
      );
      expect(run()).toMatchObject([
        { client: "Jane Roe", invoiceId: "AB0042" },
        { client: "Sam P.", invoiceId: "AB0043" },
      ]);
      expect(numbers()).toEqual({
        last: "AB0043",
        drafts: { [JANE_DRAFT]: "AB0042", [SAM_DRAFT]: "AB0043" },
      });
    });

    it("does not use up a number for a client it skips", () => {
      const { run, numbers } = setup(
        {},
        {
          entries: [
            entry("Unknown Client", "2000-03-01 09:00", 60),
            entry("Jane Roe", "2000-03-01 09:00", 60),
          ],
        }
      );
      expect(run()).toMatchObject([
        { kind: "created", client: "Jane Roe", invoiceId: "AB0042" },
        { kind: "skipped", client: "Unknown Client" },
      ]);
      expect(numbers().last).toBe("AB0042");
    });

    it("throws if there is nothing to continue from", () => {
      const { run } = setup(
        { "raw/earlier.cfg": "[META]\n" },
        { entries: JANE_MARCH }
      );
      expect(run).toThrow(/No invoice ids found/);
    });

    it("throws for numbers that cannot be read", () => {
      const { run } = setup({ [NUMBERS]: "nonsense" }, { entries: JANE_MARCH });
      expect(run).toThrow(/is not valid, expected/);
    });
  });

  describe("drafting the same file again", () => {
    it("reuses the id it was given and does not use up a number", () => {
      const { run, deleteDraft, hasDraft, numbers } = setup(
        {},
        { entries: JANE_MARCH }
      );
      run();
      deleteDraft(JANE_DRAFT);
      expect(hasDraft(JANE_DRAFT)).toBe(false);

      expect(run()).toMatchObject([
        { kind: "created", invoiceId: "AB0042", idSource: "recorded" },
      ]);
      expect(hasDraft(JANE_DRAFT)).toBe(true);
      expect(numbers()).toEqual({
        last: "AB0042",
        drafts: { [JANE_DRAFT]: "AB0042" },
      });
    });

    it("writes the same draft again", () => {
      const { run, draft, deleteDraft } = setup({}, { entries: JANE_MARCH });
      run();
      const first = draft(JANE_DRAFT);
      deleteDraft(JANE_DRAFT);
      run();
      expect(draft(JANE_DRAFT)).toBe(first);
    });

    it("keeps each draft's own id when others have been drafted since", () => {
      const { run, deleteDraft, numbers } = setup(
        {},
        { entries: [...JANE_MARCH, ...SAM_MARCH] }
      );
      run();
      deleteDraft(JANE_DRAFT);
      expect(run()).toMatchObject([
        { client: "Jane Roe", invoiceId: "AB0042", idSource: "recorded" },
        { client: "Sam P.", kind: "skipped" },
      ]);
      expect(numbers().last).toBe("AB0043");
    });

    it("gives a new id to a draft with a different file name", () => {
      const { run, numbers } = setup({}, { entries: JANE_MARCH });
      run();
      expect(run({ today: "2000-04-04" })).toMatchObject([
        { kind: "created", invoiceId: "AB0043", idSource: "new" },
      ]);
      expect(numbers()).toEqual({
        last: "AB0043",
        drafts: {
          [JANE_DRAFT]: "AB0042",
          "janeRoe.2000.04.04.cfg": "AB0043",
        },
      });
    });

    it("does not overwrite a draft that already exists, or change the numbers", () => {
      const { run, draft, numbers } = setup({}, { entries: JANE_MARCH });
      run();
      const before = numbers();
      expect(run()).toMatchObject([
        {
          kind: "skipped",
          client: "Jane Roe",
          reason: expect.stringContaining("already exists") as string,
        },
      ]);
      expect(numbers()).toEqual(before);
      expect(draft(JANE_DRAFT)).toContain("invoice_id=AB0042");
    });
  });

  describe("a given invoice id", () => {
    it("is used instead of the next one", () => {
      const { run, draft } = setup({}, { entries: JANE_MARCH });
      expect(run({ invoiceId: "AB0099" })).toMatchObject([
        { kind: "created", invoiceId: "AB0099", idSource: "given" },
      ]);
      expect(draft(JANE_DRAFT)).toContain("invoice_id=AB0099");
    });

    it("does not change the last id that the next one continues from", () => {
      const { run, numbers } = setup(
        { [NUMBERS]: JSON.stringify({ last: "AB0100" }) },
        { entries: JANE_MARCH }
      );
      run({ invoiceId: "AB0099" });
      expect(numbers().last).toBe("AB0100");
    });

    it("does not set a last id if there was none", () => {
      const { run, numbers } = setup({}, { entries: JANE_MARCH });
      run({ invoiceId: "AB0099" });
      expect(numbers()).toEqual({
        last: undefined,
        drafts: { [JANE_DRAFT]: "AB0099" },
      });
    });

    it("is recorded for the draft, so drafting it again reuses it", () => {
      const { run, deleteDraft } = setup({}, { entries: JANE_MARCH });
      run({ invoiceId: "AB0099" });
      deleteDraft(JANE_DRAFT);
      expect(run()).toMatchObject([
        { invoiceId: "AB0099", idSource: "recorded" },
      ]);
    });

    it("replaces the id recorded for the draft", () => {
      const { run, deleteDraft, numbers } = setup({}, { entries: JANE_MARCH });
      run();
      deleteDraft(JANE_DRAFT);
      expect(run({ invoiceId: "AB0050" })).toMatchObject([
        { invoiceId: "AB0050", idSource: "given" },
      ]);
      expect(numbers().drafts[JANE_DRAFT]).toBe("AB0050");
      expect(numbers().last).toBe("AB0042");
    });

    it("needs a single client", () => {
      const { run, numbers, hasDraft } = setup(
        {},
        { entries: [...JANE_MARCH, ...SAM_MARCH] }
      );
      expect(() => run({ invoiceId: "AB0099" })).toThrow(
        "An invoice id is for a single invoice but 2 clients have something to bill (Jane Roe, Sam P.), so choose one with --client"
      );
      expect(hasDraft(JANE_DRAFT)).toBe(false);
      expect(hasDraft(SAM_DRAFT)).toBe(false);
      expect(numbers()).toEqual({ last: undefined, drafts: {} });
    });

    it("counts clients that would be skipped", () => {
      const { run } = setup(
        {},
        {
          entries: [
            entry("Unknown Client", "2000-03-01 09:00", 60),
            ...JANE_MARCH,
          ],
        }
      );
      expect(() => run({ invoiceId: "AB0099" })).toThrow(
        /2 clients have something to bill/
      );
    });

    it("can be used for one client out of several, by choosing it", () => {
      const { run, hasDraft } = setup(
        {},
        { entries: [...JANE_MARCH, ...SAM_MARCH] }
      );
      expect(run({ invoiceId: "AB0099", client: "Sam P." })).toMatchObject([
        { kind: "created", client: "Sam P.", invoiceId: "AB0099" },
      ]);
      expect(hasDraft(JANE_DRAFT)).toBe(false);
      expect(hasDraft(SAM_DRAFT)).toBe(true);
    });

    it("does not overwrite a draft that exists, or record anything", () => {
      const { run, numbers } = setup(
        { [`raw/${JANE_DRAFT}`]: "[META]\nmine=edited\n" },
        { entries: JANE_MARCH }
      );
      expect(run({ invoiceId: "AB0099" })).toMatchObject([{ kind: "skipped" }]);
      expect(numbers()).toEqual({ last: undefined, drafts: {} });
    });
  });

  describe("choosing a client", () => {
    const both = [...JANE_MARCH, ...SAM_MARCH];

    it("only drafts that client", () => {
      const { run, hasDraft } = setup({}, { entries: both });
      expect(run({ client: "Jane Roe" })).toMatchObject([
        { kind: "created", client: "Jane Roe" },
      ]);
      expect(hasDraft(JANE_DRAFT)).toBe(true);
      expect(hasDraft(SAM_DRAFT)).toBe(false);
    });

    it.each(["jane roe", "JANE-ROE", "janeRoe"])(
      "ignores case and spacing (%s)",
      client => {
        const { run } = setup({}, { entries: both });
        expect(run({ client })).toMatchObject([{ client: "Jane Roe" }]);
      }
    );

    it("drafts nothing if the client has nothing to bill", () => {
      const { run, numbers } = setup({}, { entries: both });
      expect(run({ client: "Nobody" })).toEqual([]);
      expect(numbers()).toEqual({ last: undefined, drafts: {} });
    });
  });

  describe("matching clients", () => {
    it.each(["Jane Roe", "jane roe", "JANE-ROE", "jane_roe", "janeroe"])(
      "matches a config by its file name, ignoring case and spacing (%s)",
      name => {
        const { run, hasDraft } = setup(
          {},
          { entries: [entry(name, "2000-03-01 09:00", 60)] }
        );
        expect(run()).toMatchObject([{ kind: "created", client: name }]);
        expect(hasDraft(JANE_DRAFT)).toBe(true);
      }
    );

    it("does not match a different name", () => {
      const { run } = setup(
        {},
        { entries: [entry("Jane Roe Ltd", "2000-03-01 09:00", 60)] }
      );
      expect(run()).toMatchObject([{ kind: "skipped" }]);
    });

    it("skips a second name for the same config, as its draft already exists", () => {
      const { run } = setup(
        {},
        {
          entries: [
            entry("Jane Roe", "2000-03-01 09:00", 60),
            entry("jane-roe", "2000-03-02 09:00", 60),
          ],
        }
      );
      expect(run().map(result => result.kind)).toEqual(["created", "skipped"]);
    });

    it("matches a config that names the client with timetracker_client", () => {
      const { run, hasDraft } = setup({}, { entries: SAM_MARCH });
      expect(run()).toMatchObject([{ kind: "created", client: "Sam P." }]);
      expect(hasDraft(SAM_DRAFT)).toBe(true);
    });

    it("prefers timetracker_client over a file name match", () => {
      const { run, hasDraft } = setup(
        { "clients/aaa.cfg": "[META]\ntimetracker_client=Jane Roe\n" },
        { entries: [entry("Jane Roe", "2000-03-01 09:00", 60)] }
      );
      run();
      expect(hasDraft("aaa.2000.04.03.cfg")).toBe(true);
      expect(hasDraft(JANE_DRAFT)).toBe(false);
    });

    it("ignores files in the clients folder that are not configs", () => {
      const { run } = setup(
        { "clients/janeRoe.txt": "not a config", "clients/notes": "" },
        { entries: JANE_MARCH }
      );
      expect(run()).toMatchObject([{ kind: "created" }]);
    });

    it("skips a client with no config, saying how to fix it", () => {
      const { run, numbers } = setup(
        {},
        { entries: [entry("Unknown Client", "2000-03-01 09:00", 60)] }
      );
      expect(run()).toMatchObject([
        {
          kind: "skipped",
          client: "Unknown Client",
          reason: expect.stringContaining(
            "timetracker_client=Unknown Client"
          ) as string,
        },
      ]);
      expect(numbers()).toEqual({ last: undefined, drafts: {} });
    });

    it("throws for a client config that cannot be read", () => {
      const { run } = setup(
        { "clients/broken.cfg/inside.txt": "a folder named like a config" },
        { entries: JANE_MARCH }
      );
      expect(run).toThrow(/Could not read the client config .*broken\.cfg/);
    });
  });

  describe("descriptions", () => {
    it("uses the client's default description", () => {
      const { run, draft } = setup({}, { entries: JANE_MARCH });
      run();
      expect(draft(JANE_DRAFT)).toContain("description=Consulting");
    });

    it("leaves the description empty if the client has no default", () => {
      const { run, draft } = setup({}, { entries: SAM_MARCH });
      run();
      expect(draft(SAM_DRAFT)).toContain("description=\n");
    });

    it("prefers the notes from the app", () => {
      const { run, draft } = setup(
        {},
        {
          entries: [
            entry("Jane Roe", "2000-03-01 09:00", 60, { notes: "Fix a bug" }),
          ],
        }
      );
      run();
      expect(draft(JANE_DRAFT)).toContain("description=Fix a bug");
    });
  });

  describe("the rounding threshold", () => {
    // 7h05, so it rounds up only if the threshold is under 5 minutes
    const SEVEN_HOURS_FIVE = (client: string) => [
      entry(client, "2000-03-01 09:00", 425),
    ];
    const withThreshold = (value: string) => ({
      "clients/janeRoe.cfg": `[META]\nrounding_threshold_minutes=${value}\n`,
    });
    const hours = (results: ReturnType<ReturnType<typeof setup>["run"]>) =>
      results.map(result => (result.kind === "created" ? result.hours : null));

    it("is the default one for clients that do not set their own", () => {
      const { run } = setup({}, { entries: SEVEN_HOURS_FIVE("Sam P.") });
      expect(hours(run({ thresholdMinutes: 30 }))).toEqual([7]);
      expect(
        hours(
          setup({}, { entries: SEVEN_HOURS_FIVE("Sam P.") }).run({
            thresholdMinutes: 0,
          })
        )
      ).toEqual([8]);
    });

    it("is the client's own threshold if they set one", () => {
      const { run } = setup(withThreshold("0"), {
        entries: SEVEN_HOURS_FIVE("Jane Roe"),
        thresholdMinutes: 30,
      });
      expect(hours(run())).toEqual([8]);
    });

    it("can be higher than the default", () => {
      const { run } = setup(withThreshold("59"), {
        entries: SEVEN_HOURS_FIVE("Jane Roe"),
        thresholdMinutes: 0,
      });
      expect(hours(run())).toEqual([7]);
    });

    it("applies to each client separately", () => {
      const { run } = setup(withThreshold("0"), {
        entries: [
          ...SEVEN_HOURS_FIVE("Jane Roe"),
          ...SEVEN_HOURS_FIVE("Sam P."),
        ],
        thresholdMinutes: 30,
      });
      expect(hours(run())).toEqual([8, 7]);
    });

    it("throws for a client threshold that is not valid", () => {
      const { run } = setup(withThreshold("90"), {
        entries: SEVEN_HOURS_FIVE("Jane Roe"),
      });
      expect(run).toThrow(
        "Invalid rounding threshold '90': expected whole minutes from 0 to 59"
      );
    });
  });

  describe("skipping", () => {
    it("skips a client whose time rounds down to nothing", () => {
      const { run, numbers } = setup(
        {},
        { entries: [entry("Jane Roe", "2000-03-01 09:00", 20)] }
      );
      expect(run()).toEqual([
        {
          kind: "skipped",
          client: "Jane Roe",
          reason: "there is nothing to bill",
        },
      ]);
      expect(numbers()).toEqual({ last: undefined, drafts: {} });
    });

    it("does nothing without any entries or expenses", () => {
      expect(setup().run()).toEqual([]);
    });

    it("still writes the other clients' drafts", () => {
      const { run } = setup(
        { [`raw/${JANE_DRAFT}`]: "[META]\n" },
        { entries: [...JANE_MARCH, ...SAM_MARCH] }
      );
      expect(run().map(result => result.kind)).toEqual(["skipped", "created"]);
    });
  });

  describe("from a timetracker database to an invoice", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));

    it("makes a draft that renders as an invoice", () => {
      const db = createTimeDatabase();
      const jane = addClient(db, "Jane Roe");
      for (const [start, minutes, nonBillable] of [
        ["2000-03-01 09:00", 480, null],
        ["2000-03-02 09:00", 420, null],
        ["2000-03-10 09:00", 60, null],
        // Not billable, and in another month
        ["2000-03-11 09:00", 600, 1],
        ["2000-04-01 09:00", 600, null],
      ] as const) {
        addTime(db, { client: "Jane Roe", start, minutes, nonBillable });
      }
      addExpense(db, {
        clientId: jane,
        date: "2000-03-05",
        category: "Domain",
        amount: 10,
      });

      const { dir, run } = setup({
        "raw/default.cfg": lines(
          "[META]",
          "invoice_terms=7 days",
          "",
          "[PAYMENT]",
          "currency=\\pounds"
        ),
      });
      expect(
        run({
          entries: readTimeEntries(db, 2000, 3),
          expenses: readExpenses(db, 2000, 3),
        })
      ).toMatchObject([{ kind: "created", hours: 16, items: 3, expenses: 1 }]);

      const invoice = renderTemplate(
        join(dir, "raw", JANE_DRAFT),
        join(root, "invoice_template.tex")
      );
      // 16 hours at 50 plus the 10 expense
      expect(invoice).toContain("\\large{\\pounds810.00}");
      expect(invoice).toContain("Consulting");
      expect(invoice).toContain("Domain");
      expect(invoice).toContain("AB0042");
      expect(invoice).toContain("2000/04/03");
      const days = [" 1st Mar", " 2nd Mar", "10th Mar"].map(day =>
        invoice.indexOf(day)
      );
      expect(days.every(index => index > 0)).toBe(true);
      expect(days).toEqual(days.toSorted((a, b) => a - b));
    });
  });
});
