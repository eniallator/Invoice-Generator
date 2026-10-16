// Integration tests: every example in README.md, run end to end through the
// config loader, context variables and template parser.
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCli } from "./cli.ts";
import { loadConfig } from "./imports.ts";
import { contextFrom, createFiles, lines, render } from "./test-helpers.ts";

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
      template: "./invoice_template.tex",
      outPath: "./out/johnDoe.2000.01.01.tex",
      keepAux: false,
    });
  });

  it("--template / -t chooses the template file", () => {
    expect(parseCli(["-t", "./mine.tex", exampleCfg])).toMatchObject({
      template: "./mine.tex",
    });
    expect(parseCli(["--template", "./mine.tex", exampleCfg])).toMatchObject({
      template: "./mine.tex",
    });
  });

  it("--out-path / -o chooses the output destination", () => {
    expect(parseCli(["-o", "./out/mine.tex", exampleCfg])).toMatchObject({
      outPath: "./out/mine.tex",
    });
    expect(
      parseCli(["--out-path", "./out/mine.tex", exampleCfg])
    ).toMatchObject({ outPath: "./out/mine.tex" });
  });

  it("--quote / -q switches the default template to the quote template", () => {
    expect(parseCli(["-q", exampleCfg])).toMatchObject({
      template: "./quote_template.tex",
    });
    expect(parseCli(["--quote", exampleCfg])).toMatchObject({
      template: "./quote_template.tex",
    });
  });

  it("--keep-aux / -k keeps the auxiliary files", () => {
    expect(parseCli(["-k", exampleCfg])).toMatchObject({ keepAux: true });
    expect(parseCli(["--keep-aux", exampleCfg])).toMatchObject({
      keepAux: true,
    });
  });

  it("explicit options override the quote defaults", () => {
    expect(
      parseCli(["-q", "-t", "./mine.tex", "-o", "./out/mine.tex", exampleCfg])
    ).toMatchObject({ template: "./mine.tex", outPath: "./out/mine.tex" });
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
          "\\underline{INV DATE} {{ invoice_date }}",
          "Pay to: {{ PAYMENT.account_name }}"
        ),
        cfg
      )
    ).toBe(lines("\\underline{INV DATE} 2000/01/01", "Pay to: John Doe"));
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
        "{* map ./invoice_item.tex ITEM */}Total: {{ ITEM_total_due }}"
      ),
      ITEMS_CFG,
      {
        "invoice_item.tex":
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
