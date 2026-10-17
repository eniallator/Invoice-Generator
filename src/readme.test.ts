// Integration tests: every example in README.md, run end to end through the
// config loader, context variables and template parser.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseCli } from "./cli.ts";
import { loadConfig } from "./config/imports.ts";
import { parseEmail, parseRecipients } from "./email/message.ts";
import { readText } from "./io.ts";
import { contextFrom, createFiles, lines, render } from "./test-helpers.ts";
import { createDrafts } from "./timetracker/drafts.ts";
import { roundHours } from "./timetracker/rounding.ts";

const ITEMS_CFG = lines(
  "[ITEM_1]",
  "",
  "hrs=5",
  "rate=6",
  "",
  "[ITEM_2]",
  "",
  "hrs=2",
  "rate=3"
);

const RECURRING_CFG = lines(
  "[ITEM_1]",
  "",
  "hrs=5",
  "rate=6",
  "recurring=40",
  "",
  "[ITEM_2]",
  "",
  "hrs=2",
  "rate=3",
  "recurring=40"
);

describe("README: Command Usage", () => {
  const exampleCfg = "./raw_invoices/johnDoe.2000.01.01.cfg";

  it("generates the example invoice from the config file argument", () => {
    expect(parseCli([exampleCfg])).toEqual({
      kind: "run",
      cfg: exampleCfg,
      template: "./invoice_template.typ",
      outPath: "./out/johnDoe.2000.01.01.typ",
    });
  });

  it("--template / -t chooses the template file", () => {
    expect(parseCli(["-t", "./mine.typ", exampleCfg])).toMatchObject({
      template: "./mine.typ",
    });
    expect(parseCli(["--template", "./mine.typ", exampleCfg])).toMatchObject({
      template: "./mine.typ",
    });
  });

  it("--out-path / -o chooses the output destination", () => {
    expect(parseCli(["-o", "./out/mine.typ", exampleCfg])).toMatchObject({
      outPath: "./out/mine.typ",
    });
    expect(
      parseCli(["--out-path", "./out/mine.typ", exampleCfg])
    ).toMatchObject({ outPath: "./out/mine.typ" });
  });

  it("--quote / -q switches the default template to the quote template", () => {
    expect(parseCli(["-q", exampleCfg])).toMatchObject({
      template: "./quote_template.typ",
    });
    expect(parseCli(["--quote", exampleCfg])).toMatchObject({
      template: "./quote_template.typ",
    });
  });

  it("explicit options override the quote defaults", () => {
    expect(
      parseCli(["-q", "-t", "./mine.typ", "-o", "./out/mine.typ", exampleCfg])
    ).toMatchObject({ template: "./mine.typ", outPath: "./out/mine.typ" });
  });
});

describe("README: Importing Other Config Files", () => {
  it("imports newline separated files, without the extension, relative to the importing file", () => {
    const dir = createFiles({
      "raw/main.cfg": lines(
        "[META]",
        "",
        "import=./default",
        "  ./anothercfg",
        "  ../clients/my-client"
      ),
      "raw/default.cfg": "[META]\nfrom_default=yes",
      "raw/anothercfg.cfg": "[META]\nfrom_another=yes",
      "clients/my-client.cfg": "[CLIENT]\nname=My Client",
    });
    const config = loadConfig(join(dir, "raw", "main.cfg"));
    expect(config.get("META", "from_default")).toBe("yes");
    expect(config.get("META", "from_another")).toBe("yes");
    expect(config.get("CLIENT", "name")).toBe("My Client");
  });
});

describe("README: Invoice Items", () => {
  const cfg = lines(
    "[ITEM_1]",
    "",
    "hrs=5",
    "rate=6",
    "recurring=7",
    "",
    "[ITEM_2]",
    "",
    "hrs=2",
    "rate=3",
    "recurring=4"
  );

  it("treats the suffix of ITEM_ sections as the item's ID", () => {
    const ctx = contextFrom("[ITEM_1]\nhrs=1\n[ITEM_ONE]\nhrs=1");
    expect(ctx.calculateItems("ITEM").map(item => item.get("id"))).toEqual([
      "1",
      "ONE",
    ]);
  });

  it("gives each item its id, subtotal and formatted numbers", () => {
    const items = contextFrom(cfg)
      .calculateItems("ITEM")
      .map(item => Object.fromEntries(item));
    expect(items).toEqual([
      { id: "1", subtotal: "30.00", hrs: "5", rate: "6.00", recurring: "7.00" },
      { id: "2", subtotal: "6.00", hrs: "2", rate: "3.00", recurring: "4.00" },
    ]);
  });

  it("gives every group its total, recurring total and joined options", () => {
    const ctx = contextFrom(cfg);
    expect(ctx.getVariable("ITEM_total_due")).toBe("36.00");
    expect(ctx.getVariable("ITEM_total_recurring_due")).toBe("11.00");
    expect(ctx.getVariable("ITEM_hrs")).toBe("5, 2");
  });

  it("leaves the recurring total empty if nothing recurs", () => {
    expect(contextFrom(ITEMS_CFG).getVariable("ITEM_total_recurring_due")).toBe(
      ""
    );
  });

  it("works the same for any other group, such as expenses", () => {
    const ctx = contextFrom(lines("[EXPENSE_1]", "qty=2", "price=10"));
    expect(ctx.getVariable("EXPENSE_total_due")).toBe("20.00");
    expect(ctx.getVariable("EXPENSE_qty")).toBe("2");
  });

  it("uses the longest prefix that has items, and prefers the config", () => {
    const ctx = contextFrom(
      lines(
        "[META]",
        "ITEM_total_recurring_due=custom",
        "[FOO_1]",
        "qty=1",
        "price=10",
        "[FOO_BAR_1]",
        "qty=3",
        "price=2",
        "[ITEM_1]",
        "recurring=1"
      )
    );
    expect(ctx.getVariable("FOO_BAR_total_due")).toBe("6.00");
    expect(ctx.getVariable("FOO_total_due")).toBe("16.00");
    expect(ctx.getVariable("ITEM_total_recurring_due")).toBe("custom");
  });

  it("does not work anything out until it is used", () => {
    const ctx = contextFrom(lines("[ITEM_1]", "hrs=5", "rate=oops"));
    expect(ctx.getVariable("some_other_variable")).toBe("");
    expect(() => ctx.getVariable("ITEM_total_due")).toThrow();
  });
});

describe("README: Context Variables", () => {
  const cfg = lines(
    "[META]",
    "",
    "invoice_date=2000/01/01",
    "",
    "[PAYMENT]",
    "",
    "account_name=John Doe"
  );

  it("inserts section.option and bare META variables", () => {
    expect(
      render(
        lines(
          "#underline[INV DATE] {{ invoice_date }}",
          "Pay to: {{ PAYMENT.account_name }}"
        ),
        cfg
      )
    ).toBe(lines("#underline[INV DATE] 2000/01/01", "Pay to: John Doe"));
  });

  it("replaces variables it cannot find with an empty string", () => {
    expect(render("[{{ nothing }}][{{ PAYMENT.nothing }}]", cfg)).toBe("[][]");
  });
});

describe("README: Map Directive", () => {
  it("maps a contents file over the items", () => {
    // The README shows the map output on separate lines, so the contents file
    // ends with a newline and the tag sits directly before "Total".
    const result = render(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal",
        "{* map ./invoice_item.typ ITEM */}Total: {{ ITEM_total_due }}"
      ),
      ITEMS_CFG,
      {
        "invoice_item.typ":
          "{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}\n",
      }
    );
    expect(result).toBe(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal",
        "1, 5, 6.00, 30.00",
        "2, 2, 3.00, 6.00",
        "Total: 36.00"
      )
    );
  });

  it("repeats the contents for each section in alphabetical order", () => {
    expect(
      render(
        "{* map ITEM *}{{ ITEM.id }};{/* map *}",
        lines("[ITEM_b]", "[ITEM_a]", "[ITEM_c]", "[OTHER_x]")
      )
    ).toBe("a;b;c;");
  });

  it("keeps the group's variables and outer items available inside", () => {
    const cfg = lines(
      ITEMS_CFG,
      "[EXPENSE_1]",
      "description=Travel",
      "qty=1",
      "price=10"
    );
    const result = render(
      "{* map ITEM *}Item {{ ITEM.id }} ({{ ITEM.subtotal }} of {{ ITEM_total_due }}):{* map EXPENSE *} {{ EXPENSE.description }}{/* map *}\n{/* map *}",
      cfg
    );
    expect(result).toBe(
      lines(
        "Item 1 (30.00 of 36.00): Travel",
        "Item 2 (6.00 of 36.00): Travel",
        ""
      )
    );
  });

  it("lets an inner item replace an outer one with the same prefix", () => {
    expect(
      render(
        "{* map ITEM *}{* map ITEM *}{{ ITEM.id }}{/* map *}|{/* map *}",
        ITEMS_CFG
      )
    ).toBe("12|12|");
  });
});

describe("README: Inline Items Directive", () => {
  it("maps inline contents between the opening and closing tags", () => {
    const result = render(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal{* map ITEM *}",
        "{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{/* map *}",
        "Total: {{ ITEM_total_due }}"
      ),
      ITEMS_CFG
    );
    expect(result).toBe(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal",
        "1, 5, 6.00, 30.00",
        "2, 2, 3.00, 6.00",
        "Total: 36.00"
      )
    );
  });
});

describe("README: When Directive", () => {
  const template = lines(
    "Invoice Items:",
    "ID, hrs, rate, subtotal{* when ITEM_total_recurring_due *}, Recurring{/* when *}{* map ITEM *}",
    "{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{* when ITEM_total_recurring_due *}, {{ITEM.recurring}}{/* when *}{/* map *}",
    "Total: {{ ITEM_total_due }}{* when ITEM_total_recurring_due *}",
    "Total Recurring: {{ITEM_total_recurring_due}}{/* when *}",
    ""
  );

  it("shows the contents when the variable has a value", () => {
    expect(render(template, RECURRING_CFG)).toBe(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal, Recurring",
        "1, 5, 6.00, 30.00, 40.00",
        "2, 2, 3.00, 6.00, 40.00",
        "Total: 36.00",
        "Total Recurring: 80.00",
        ""
      )
    );
  });

  it("omits the contents when the variable does not exist", () => {
    expect(render(template, ITEMS_CFG)).toBe(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal",
        "1, 5, 6.00, 30.00",
        "2, 2, 3.00, 6.00",
        "Total: 36.00",
        ""
      )
    );
  });

  it("unless does the inverse of when", () => {
    const unless =
      "{* unless ITEM_total_recurring_due *}nothing recurring{/* unless *}";
    expect(render(unless, ITEMS_CFG)).toBe("nothing recurring");
    expect(render(unless, RECURRING_CFG)).toBe("");
  });
});

describe("README: Add Directive", () => {
  const cfg = lines(
    "[ITEM_1]",
    "",
    "hrs=5",
    "rate=6",
    "",
    "[EXPENSE_1]",
    "",
    "qty=2",
    "price=10"
  );

  it("adds up the variables given as arguments", () => {
    expect(
      render("Total: {* add ITEM_total_due EXPENSE_total_due */}", cfg)
    ).toBe("Total: 50.00");
  });

  it("adds up the variables given as the arguments and the contents", () => {
    expect(
      render("Total: {* add ITEM_total_due *}EXPENSE_total_due{/* add *}", cfg)
    ).toBe("Total: 50.00");
  });

  it("counts empty and missing variables as zero", () => {
    expect(
      render("{* add ITEM_total_due ITEM_total_recurring_due NOPE */}", cfg)
    ).toBe("30.00");
  });

  it("adds up the variables given as the contents alone", () => {
    expect(
      render("Total: {* add *}ITEM_total_due EXPENSE_total_due{/* add *}", cfg)
    ).toBe("Total: 50.00");
  });

  it("needs at least two variables", () => {
    expect(() => render("{* add ITEM_total_due */}", cfg)).toThrow(
      "add directive needs at least two context variables to add up"
    );
  });
});

describe("README: Time Tracker (optional)", () => {
  const entry = (start: string, minutes: number) => ({
    client: "Jane Roe",
    project: "Website",
    rate: 50,
    start,
    minutes,
    notes: "",
  });

  const setup = () => {
    const dir = createFiles({
      "clients/janeRoe.cfg": lines(
        "[META]",
        "",
        "default_description=Consulting"
      ),
      "raw_invoices/default.cfg": "[META]\n",
      "raw_invoices/earlier.cfg": "[META]\ninvoice_id=AB0041\n",
    });
    const draft = () =>
      createDrafts({
        entries: [
          entry("2000-03-01 09:00", 480),
          entry("2000-03-02 09:00", 420),
        ],
        expenses: [],
        clientsDir: join(dir, "clients"),
        rawInvoicesDir: join(dir, "raw_invoices"),
        numbersPath: join(dir, ".invoice-numbers.json"),
        today: "2000-04-03",
        thresholdMinutes: 30,
      });
    return {
      dir,
      draft,
      path: join(dir, "raw_invoices", "janeRoe.2000.04.03.cfg"),
    };
  };

  it("drafts a raw invoice for a client with time in the month", () => {
    const { draft, path } = setup();
    draft();
    expect(readText(path)).toBe(
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

  it("rounds the days so they add up to the month's total", () => {
    // 22h45 in total rounds up to 23h with a threshold of 30 minutes
    expect(roundHours([475, 460, 430], 30)).toEqual([8, 8, 7]);
  });

  it("never overwrites an existing draft", () => {
    const { draft, path } = setup();
    draft();
    expect(draft()).toMatchObject([{ kind: "skipped" }]);
    expect(readText(path)).toContain("invoice_id=AB0042");
  });

  it("reuses a draft's invoice id when it is written again", () => {
    const { draft, path } = setup();
    draft();
    rmSync(path);
    expect(draft()).toMatchObject([
      { kind: "created", invoiceId: "AB0042", idSource: "recorded" },
    ]);
  });
});

describe("README: Emailing Invoices (optional)", () => {
  const cfg = lines(
    "[META]",
    "",
    "invoice_id=AB0042",
    "invoice_date=2000/04/03",
    "invoice_terms=7 days",
    "",
    "[INVOICE_TO]",
    "",
    "fullname=Jane Roe",
    "email=jane@example.com",
    "",
    "[INVOICE_FROM]",
    "",
    "fullname=John Doe"
  );
  const template = readText(
    join(fileURLToPath(new URL("../", import.meta.url)), "email_template.txt")
  );

  it("makes the subject and body from the default email template", () => {
    expect(parseEmail(render(template, cfg))).toEqual({
      subject: "Invoice AB0042",
      body: lines(
        "Hi Jane Roe,",
        "",
        "Please find attached invoice AB0042, dated 2000/04/03. Payment details are on the invoice, and the terms are 7 days.",
        "",
        "Let me know if you have any questions.",
        "",
        "Thanks,",
        "John Doe",
        ""
      ),
    });
  });

  it("emails the invoice to the email in INVOICE_TO", () => {
    expect(
      parseRecipients(contextFrom(cfg).getVariable("INVOICE_TO.email"))
    ).toEqual(["jane@example.com"]);
  });

  it("can email several addresses", () => {
    expect(parseRecipients("a@example.com, b@example.com")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });
});
