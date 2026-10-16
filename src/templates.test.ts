// Regression tests: the real invoice and quote templates rendered against
// configs that cover the situations they have to handle. These pin the parts
// of the output that matter (totals, which tables and columns show), so a
// change to the engine that alters what a real invoice looks like is caught.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readText } from "./io.ts";
import { lines, render } from "./test-helpers.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const INVOICE = readText(join(root, "invoice_template.tex"));
const QUOTE = readText(join(root, "quote_template.tex"));

const PAYMENT = lines(
  "[PAYMENT]",
  "currency=\\pounds",
  "account_name=Account Name"
);

const invoice = (...sections: string[]) =>
  render(
    INVOICE,
    lines(
      "[INVOICE_TO]",
      "fullname=Jane Client",
      "address=1 Road",
      "contact=jane@example.com",
      "[INVOICE_FROM]",
      "fullname=Me",
      "address=2 Road",
      "contact=me@example.com",
      PAYMENT,
      ...sections
    )
  );

const quote = (...sections: string[]) =>
  render(
    QUOTE,
    lines(
      "[QUOTE_TO]",
      "fullname=Jane Client",
      "address=1 Road",
      "contact=jane@example.com",
      "[QUOTE_FROM]",
      "fullname=Me",
      "address=2 Road",
      "contact=me@example.com",
      PAYMENT,
      ...sections
    )
  );

const ITEM_TABLE = "\\bf{ITEM}";
const EXPENSE_TABLE = "\\bf{EXPENSE}";

describe("invoice_template.tex", () => {
  it("fills in the parties and payment details", () => {
    const result = invoice();
    expect(result).toContain("\\textbf{Me}");
    expect(result).toContain(
      "1 Road\\\\Attention: Jane Client\\\\jane@example.com"
    );
    expect(result).toContain("Account Name: Account Name");
  });

  describe("with items only", () => {
    const result = invoice(
      "[ITEM_1]",
      "description=Work",
      "hrs=5",
      "rate=6",
      "[ITEM_2]",
      "description=More work",
      "hrs=2",
      "rate=3"
    );

    it("shows the item table with each item", () => {
      expect(result).toContain(ITEM_TABLE);
      expect(result).toMatch(/1\s*&\s*Work/);
      expect(result).toMatch(/2\s*&\s*More work/);
    });

    it("shows each item's formatted rate and subtotal", () => {
      expect(result).toMatch(/5\s*&\s*\\pounds6\.00\s*&\s*\\pounds30\.00/);
      expect(result).toMatch(/2\s*&\s*\\pounds3\.00\s*&\s*\\pounds6\.00/);
    });

    it("puts the currency on each subtotal, not in the heading", () => {
      expect(result).toContain("\\bf SUB TOTAL ");
      expect(result).not.toContain("SUB TOTAL(");
    });

    it("left aligns the text columns and right aligns the numeric columns", () => {
      expect(result).toContain("{l X r r r}");
    });

    it("totals the items in the item table", () => {
      expect(result).toContain("\\large{\\pounds36.00}");
    });

    it("has no expense table", () => {
      expect(result).not.toContain(EXPENSE_TABLE);
    });
  });

  describe("with items and expenses", () => {
    const result = invoice(
      "[ITEM_1]",
      "description=Work",
      "hrs=5",
      "rate=6",
      "[EXPENSE_1]",
      "description=Travel",
      "qty=2",
      "price=10"
    );

    it("shows both tables", () => {
      expect(result).toContain(ITEM_TABLE);
      expect(result).toContain(EXPENSE_TABLE);
      expect(result).toContain("Travel");
    });

    it("only shows the combined total, in the expense table", () => {
      expect(result).toContain("\\large{\\pounds50.00}");
      expect(result).not.toContain("\\large{\\pounds30.00}");
      expect(result.match(/\\large\{\\pounds/g)).toHaveLength(1);
    });
  });

  describe("with expenses only", () => {
    const result = invoice("[EXPENSE_1]", "description=Fee", "subtotal=15");

    it("has no item table, and the expenses make up the total", () => {
      expect(result).not.toContain(ITEM_TABLE);
      expect(result).toContain(EXPENSE_TABLE);
      expect(result).toContain("\\large{\\pounds15.00}");
    });

    it("leaves out the columns that no expense uses", () => {
      expect(result).not.toContain("\\bf{QTY}");
      expect(result).not.toContain("\\bf{RATE}");
    });
  });

  describe("with nothing to bill", () => {
    const result = invoice();

    it("shows neither table", () => {
      expect(result).not.toContain(ITEM_TABLE);
      expect(result).not.toContain(EXPENSE_TABLE);
      expect(result).not.toContain("\\large{\\pounds");
    });
  });

  describe("columns", () => {
    it("shows the hours and rate columns when items use them", () => {
      const result = invoice("[ITEM_1]", "hrs=5", "rate=6");
      expect(result).toContain("\\bf{HRS}");
      expect(result).toContain("\\bf{RATE/HR}");
      expect(result).not.toContain("\\bf{DAYS}");
    });

    it("shows the days column when items use it", () => {
      const result = invoice("[ITEM_1]", "days=2", "rate=100");
      expect(result).toContain("\\bf{DAYS}");
      expect(result).not.toContain("\\bf{HRS}");
      expect(result).toContain("\\large{\\pounds200.00}");
    });

    it("shows a column if any one item uses it", () => {
      const result = invoice(
        "[ITEM_1]",
        "hrs=5",
        "rate=6",
        "[ITEM_2]",
        "days=2",
        "rate=100"
      );
      expect(result).toContain("\\bf{HRS}");
      expect(result).toContain("\\bf{DAYS}");
      expect(result).toContain("\\large{\\pounds230.00}");
    });

    it("shows the quantity and rate columns for expenses that use them", () => {
      const result = invoice("[EXPENSE_1]", "qty=2", "price=10", "rate=10");
      expect(result).toContain("\\bf{QTY}");
      expect(result).toContain("\\bf{RATE}");
      expect(result).toMatch(/2\s*&\s*\\pounds10\.00\s*&\s*\\pounds20\.00/);
    });
  });

  describe("subheading", () => {
    it("is shown when there is one", () => {
      expect(invoice("[META]", "invoice_subheading=PO 123")).toContain(
        "\\normalsize\\textbf{PO 123}"
      );
    });

    it("is left out when there is not", () => {
      expect(invoice()).not.toContain("\\normalsize\\textbf{");
    });
  });
});

describe("quote_template.tex", () => {
  it("fills in the parties and terms", () => {
    const result = quote("[META]", "quote_terms=30 days");
    expect(result).toContain("\\textbf{Me}");
    expect(result).toContain("Attention: Jane Client");
    expect(result).toContain("\\underline{Payment Terms:} 30 days");
  });

  describe("with items", () => {
    const result = quote(
      "[ITEM_1]",
      "description=Build",
      "responsibility=Everything",
      "hrs=5",
      "rate=6",
      "[ITEM_2]",
      "description=Test",
      "responsibility=All of it",
      "hrs=2",
      "rate=3"
    );

    it("lists each item with its subtotal", () => {
      expect(result).toContain("1 & Build");
      expect(result).toContain("\\pounds30.00");
      expect(result).toContain("2 & Test");
      expect(result).toContain("\\pounds6.00");
    });

    it("left aligns the text columns and right aligns the subtotal", () => {
      expect(result).toContain("{l X r}");
    });

    it("shows a provided subtotal to two decimal places", () => {
      expect(quote("[ITEM_1]", "description=Build", "subtotal=300")).toContain(
        "\\pounds300.00"
      );
    });

    it("totals the items", () => {
      expect(result).toContain("\\large{\\pounds36.00}");
    });

    it("lists each item's responsibility", () => {
      expect(result).toContain("\\item \\textbf{Build} - Everything");
      expect(result).toContain("\\item \\textbf{Test} - All of it");
    });
  });

  // A group with no items has no total (that is what lets the invoice hide its
  // item table), so the quote falls back to zero itself
  it("shows a total of zero when there are no items", () => {
    expect(quote()).toContain("\\large{\\pounds0.00}");
  });

  it("does not show the zero fallback when there are items", () => {
    const result = quote("[ITEM_1]", "hrs=1", "rate=5");
    expect(result).toContain("\\large{\\pounds5.00}");
    expect(result).not.toContain("0.00");
  });
});
