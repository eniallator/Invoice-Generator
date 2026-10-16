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
    ).toMatchObject({
      outPath: "./out/mine.tex",
    });
  });

  it("--quote / -q switches the default template to the quote template", () => {
    expect(parseCli(["-q", exampleCfg])).toMatchObject({
      template: "./quote_template.tex",
    });
    expect(parseCli(["--quote", exampleCfg])).toMatchObject({
      template: "./quote_template.tex",
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

  it("adds up the subtotals and recurring amounts into META", () => {
    const ctx = contextFrom(cfg);
    expect(ctx.getVariable("total_due")).toBe("36.00");
    expect(ctx.getVariable("total_recurring_due")).toBe("11.00");
  });

  it("works out each item's id and subtotal and formats the recurring amount", () => {
    const items = contextFrom(cfg)
      .calculateItems("ITEM")
      .map(item => Object.fromEntries(item));
    expect(items).toMatchObject([
      { id: "1", subtotal: "30.00", recurring: "7.00" },
      { id: "2", subtotal: "6.00", recurring: "4.00" },
    ]);
  });

  it("formats rate to two decimal places and leaves whole hrs as written", () => {
    const items = contextFrom(cfg)
      .calculateItems("ITEM")
      .map(item => Object.fromEntries(item));
    expect(items).toMatchObject([
      { hrs: "5", rate: "6.00" },
      { hrs: "2", rate: "3.00" },
    ]);
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
        "{* map ./invoice_item.tex ITEM *}Total: {{ total_due }}"
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
});

describe("README: Inline Items Directive", () => {
  it("maps inline contents between the opening and closing tags", () => {
    const result = render(
      lines(
        "Invoice Items:",
        "ID, hrs, rate, subtotal{* map ITEM *}",
        "{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{/* map *}",
        "Total: {{ total_due }}"
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
    "ID, hrs, rate, subtotal{* when total_recurring_due *}, Recurring{/* when *}{* map ITEM *}",
    "{{ ITEM.id }}, {{ ITEM.hrs }}, {{ ITEM.rate }}, {{ ITEM.subtotal }}{* when total_recurring_due *}, {{ITEM.recurring}}{/* when *}{/* map *}",
    "Total: {{ total_due }}{* when total_recurring_due *}",
    "Total Recurring: {{total_recurring_due}}{/* when *}",
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
      "{* unless total_recurring_due *}nothing recurring{/* unless *}";
    expect(render(unless, ITEMS_CFG)).toBe("nothing recurring");
    expect(render(unless, RECURRING_CFG)).toBe("");
  });
});
