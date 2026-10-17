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
const INVOICE = readText(join(root, "invoice_template.typ"));
const QUOTE = readText(join(root, "quote_template.typ"));

const PAYMENT = lines("[PAYMENT]", "currency=£", "account_name=Account Name");

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

const ITEM_TABLE = "head[ITEM]";
const EXPENSE_TABLE = "head[EXPENSE]";
const TOTAL = "#total[£";

describe("invoice_template.typ", () => {
  it("fills in the parties and payment details", () => {
    const result = invoice();
    expect(result).toContain("*Me*");
    expect(result).toContain(
      "1 Road \\ Attention: Jane Client \\ jane@example.com"
    );
    expect(result).toContain("Account Name: Account Name");
  });

  describe("payment details", () => {
    const withPayment = (...options: string[]) =>
      render(INVOICE, lines("[PAYMENT]", "bank=B", ...options));

    it("leaves out the account address and bank address when there are none", () => {
      const result = withPayment();
      expect(result).not.toContain("Account Address");
      expect(result).not.toContain("Bank Address");
    });

    it("shows the account address when there is one", () => {
      expect(withPayment("account_address=1 Road, Town")).toContain(
        "Account Address: 1 Road, Town"
      );
    });

    it("shows the bank address straight after the bank when there is one", () => {
      expect(withPayment("bank_address=2 Road")).toContain(
        "Bank: B \\ Bank Address: 2 Road"
      );
    });

    it("leaves out an account address that is empty", () => {
      expect(withPayment("account_address=")).not.toContain("Account Address");
    });
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
      expect(result).toContain("[1], [Work]");
      expect(result).toContain("[2], [More work]");
    });

    it("shows each item's formatted rate and subtotal", () => {
      expect(result).toContain("[5], [£6.00], [£30.00]");
      expect(result).toContain("[2], [£3.00], [£6.00]");
    });

    it("puts the currency on each subtotal, not in the heading", () => {
      expect(result).toContain("head[SUB TOTAL]");
      expect(result).not.toContain("SUB TOTAL(");
    });

    it("left aligns the text columns and right aligns the numeric columns", () => {
      expect(result).toContain("align: (left, left, right, right, right)");
    });

    it("totals the items in the item table", () => {
      expect(result).toContain("#total[£36.00]");
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
      expect(result).toContain("#total[£50.00]");
      expect(result).not.toContain("#total[£30.00]");
      expect(result.match(/#total\[£/g)).toHaveLength(1);
    });
  });

  describe("with expenses only", () => {
    const result = invoice("[EXPENSE_1]", "description=Fee", "subtotal=15");

    it("has no item table, and the expenses make up the total", () => {
      expect(result).not.toContain(ITEM_TABLE);
      expect(result).toContain(EXPENSE_TABLE);
      expect(result).toContain("#total[£15.00]");
    });

    it("leaves out the columns that no expense uses", () => {
      expect(result).not.toContain("head[QTY]");
      expect(result).not.toContain("head[RATE]");
    });
  });

  describe("with nothing to bill", () => {
    const result = invoice();

    it("shows neither table", () => {
      expect(result).not.toContain(ITEM_TABLE);
      expect(result).not.toContain(EXPENSE_TABLE);
      expect(result).not.toContain(TOTAL);
    });
  });

  describe("columns", () => {
    it("shows the hours and rate columns when items use them", () => {
      const result = invoice("[ITEM_1]", "hrs=5", "rate=6");
      expect(result).toContain("head[HRS]");
      expect(result).toContain("head[RATE/HR]");
      expect(result).not.toContain("head[DAYS]");
    });

    it("shows the days column when items use it", () => {
      const result = invoice("[ITEM_1]", "days=2", "rate=100");
      expect(result).toContain("head[DAYS]");
      expect(result).not.toContain("head[HRS]");
      expect(result).toContain("#total[£200.00]");
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
      expect(result).toContain("head[HRS]");
      expect(result).toContain("head[DAYS]");
      expect(result).toContain("#total[£230.00]");
    });

    it("shows the quantity and rate columns for expenses that use them", () => {
      const result = invoice("[EXPENSE_1]", "qty=2", "price=10", "rate=10");
      expect(result).toContain("head[QTY]");
      expect(result).toContain("head[RATE]");
      expect(result).toContain("[2], [£10.00], [£20.00]");
    });

    it("does not show a currency on its own where there is no rate", () => {
      const result = invoice("[ITEM_1]", "description=Work", "subtotal=10");
      expect(result).not.toContain("head[RATE/HR]");
      expect(result).not.toContain("[£]");
      expect(result).toContain("[Work], [£10.00]");
    });
  });

  describe("subheading", () => {
    it("is shown when there is one", () => {
      expect(invoice("[META]", "invoice_subheading=PO 123")).toContain(
        "*INVOICE*] \\ #strong[PO 123]"
      );
    });

    it("is left out when there is not", () => {
      expect(invoice()).not.toContain("*INVOICE*] \\");
    });
  });
});

describe("quote_template.typ", () => {
  it("fills in the parties and terms", () => {
    const result = quote("[META]", "quote_terms=30 days");
    expect(result).toContain("*Me*");
    expect(result).toContain("Attention: Jane Client");
    expect(result).toContain("#underline[Payment Terms:] 30 days");
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
      expect(result).toContain("[1], [Build], [£30.00]");
      expect(result).toContain("[2], [Test], [£6.00]");
    });

    it("left aligns the text columns and right aligns the subtotal", () => {
      expect(result).toContain("align: (left, left, right)");
    });

    it("shows a provided subtotal to two decimal places", () => {
      expect(quote("[ITEM_1]", "description=Build", "subtotal=300")).toContain(
        "[£300.00]"
      );
    });

    it("totals the items", () => {
      expect(result).toContain("#total[£36.00]");
    });

    it("lists each item's responsibility", () => {
      expect(result).toContain("- *Build* - Everything");
      expect(result).toContain("- *Test* - All of it");
    });
  });

  // A group with no items has no total (that is what lets the invoice hide its
  // item table), so the quote falls back to zero itself
  it("shows a total of zero when there are no items", () => {
    expect(quote()).toContain("#total[£0.00]");
  });

  it("does not show the zero fallback when there are items", () => {
    const result = quote("[ITEM_1]", "hrs=1", "rate=5");
    expect(result).toContain("#total[£5.00]");
    expect(result).not.toContain("0.00");
  });
});
