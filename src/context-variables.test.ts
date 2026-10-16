import { describe, expect, it } from "vitest";

import { contextFrom, lines } from "./test-helpers.ts";

const itemsOf = (cfg: string, prefix = "ITEM") =>
  contextFrom(cfg)
    .calculateItems(prefix)
    .map(item => Object.fromEntries(item));

describe("ContextVariables", () => {
  describe("getVariable", () => {
    const ctx = contextFrom(
      lines(
        "[META]",
        "invoice_date=2000/01/01",
        "[PAYMENT]",
        "Account_Name=John Doe"
      )
    );

    it("reads META options by bare name", () => {
      expect(ctx.getVariable("invoice_date")).toBe("2000/01/01");
    });

    it("reads options of other sections with section.option", () => {
      expect(ctx.getVariable("PAYMENT.account_name")).toBe("John Doe");
    });

    it("looks option names up case insensitively", () => {
      expect(ctx.getVariable("INVOICE_DATE")).toBe("2000/01/01");
      expect(ctx.getVariable("PAYMENT.ACCOUNT_NAME")).toBe("John Doe");
    });

    it("looks section names up case sensitively", () => {
      expect(ctx.getVariable("payment.account_name")).toBe("");
    });

    it("is an empty string for anything missing", () => {
      expect(ctx.getVariable("nope")).toBe("");
      expect(ctx.getVariable("PAYMENT.nope")).toBe("");
      expect(ctx.getVariable("NOPE.account_name")).toBe("");
    });

    it("treats a leading or trailing dot as an empty section or option", () => {
      expect(ctx.getVariable(".invoice_date")).toBe("");
      expect(ctx.getVariable("PAYMENT.")).toBe("");
      expect(ctx.getVariable(".")).toBe("");
    });

    it("rejects empty parts between separators too", () => {
      expect(() => ctx.getVariable("A..B")).toThrow("Invalid variable 'A..B'");
    });

    it("rejects more than one section separator", () => {
      expect(() => ctx.getVariable("A.B.C")).toThrow(
        "Invalid variable 'A.B.C': expected [section.]option"
      );
    });

    describe("extra context", () => {
      const extra = new Map([
        [
          "ITEM",
          new Map([
            ["id", "1"],
            ["empty", ""],
          ]),
        ],
        ["META", new Map([["invoice_date", "overridden"]])],
      ]);

      it("takes priority over the config", () => {
        expect(ctx.getVariable("ITEM.id", extra)).toBe("1");
        expect(ctx.getVariable("invoice_date", extra)).toBe("overridden");
      });

      it("keeps empty extra values rather than falling back", () => {
        const withConfig = contextFrom("[ITEM]\nempty=from config");
        expect(withConfig.getVariable("ITEM.empty", extra)).toBe("");
      });

      it("falls back to the config for anything not in it", () => {
        expect(ctx.getVariable("PAYMENT.account_name", extra)).toBe("John Doe");
        expect(ctx.getVariable("ITEM.missing", extra)).toBe("");
      });

      it("looks extra keys up case sensitively", () => {
        expect(ctx.getVariable("ITEM.ID", extra)).toBe("");
      });
    });
  });

  describe("calculateItems", () => {
    it("builds an item per section with the prefix", () => {
      expect(
        itemsOf(
          lines(
            "[ITEM_A]",
            "description=First",
            "[ITEM_B]",
            "description=Second",
            "[OTHER]",
            "x=1"
          )
        )
      ).toEqual([
        { id: "A", description: "First" },
        { id: "B", description: "Second" },
      ]);
    });

    it("only matches sections with the exact prefix and underscore", () => {
      expect(
        itemsOf(
          lines(
            "[ITEMS]",
            "a=1",
            "[ITEM]",
            "b=2",
            "[MYITEM_1]",
            "c=3",
            "[item_1]",
            "d=4",
            "[ITEM_1]",
            "e=5"
          )
        )
      ).toEqual([{ id: "1", e: "5" }]);
    });

    // Regression: sections are sorted as strings, not numerically
    it("sorts items by section name lexicographically", () => {
      expect(
        itemsOf(
          lines("[ITEM_2]", "a=1", "[ITEM_10]", "a=1", "[ITEM_1]", "a=1")
        ).map(item => item.id)
      ).toEqual(["1", "10", "2"]);
    });

    it("keeps explicit ids", () => {
      expect(itemsOf("[ITEM_1]\nid=custom")[0]?.id).toBe("custom");
    });

    it("works out subtotals and normalises numbers", () => {
      expect(itemsOf("[ITEM_1]\nhrs=5.5\nrate=10")[0]).toEqual({
        id: "1",
        hrs: "5.50",
        rate: "10.00",
        subtotal: "55.00",
      });
    });

    it("inherits options from the DEFAULT section", () => {
      expect(
        itemsOf(lines("[DEFAULT]", "rate=10", "[ITEM_1]", "hrs=2"))[0]
      ).toMatchObject({ rate: "10.00", subtotal: "20.00" });
    });

    it("is empty when no sections match", () => {
      expect(itemsOf("[META]\nx=1")).toEqual([]);
    });

    it("caches the result per prefix", () => {
      const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
      expect(ctx.calculateItems("ITEM")).toBe(ctx.calculateItems("ITEM"));
    });

    it("works for arbitrary prefixes", () => {
      const ctx = contextFrom("[FOO_x]\nqty=2\nprice=3");
      expect(ctx.calculateItems("FOO")).toHaveLength(1);
      expect(ctx.getVariable("ALL_FOOS.total_due")).toBe("6.00");
    });

    it("rejects invalid numbers", () => {
      expect(() => contextFrom("[ITEM_1]\nhrs=1.x\nrate=1")).toThrow(
        "could not convert string to float: '1.x'"
      );
      expect(() => contextFrom("[ITEM_1]\nsubtotal=lots")).toThrow(
        "could not convert string to float: 'lots'"
      );
      expect(() => contextFrom("[ITEM_1]\nrecurring=monthly")).toThrow(
        "could not convert string to float: 'monthly'"
      );
    });
  });

  describe("totals", () => {
    it("adds the item subtotals into META.total_due", () => {
      const ctx = contextFrom(
        lines("[ITEM_1]", "hrs=5", "rate=6", "[ITEM_2]", "hrs=2", "rate=3")
      );
      expect(ctx.getVariable("total_due")).toBe("36.00");
    });

    it("includes expenses in META.total_due", () => {
      const ctx = contextFrom(
        lines("[ITEM_1]", "hrs=5", "rate=6", "[EXPENSE_1]", "qty=2", "price=10")
      );
      expect(ctx.getVariable("total_due")).toBe("50.00");
      expect(ctx.getVariable("ALL_ITEMS.total_due")).toBe("30.00");
      expect(ctx.getVariable("ALL_EXPENSES.total_due")).toBe("20.00");
    });

    it("has a total due of 0.00 when there is nothing to add up", () => {
      expect(contextFrom("").getVariable("total_due")).toBe("0.00");
    });

    // Regression: a recurring total of zero used to be written as "0.00",
    // which made `when total_recurring_due` always true
    it("has no recurring total when nothing recurs", () => {
      expect(contextFrom("").getVariable("total_recurring_due")).toBe("");
      expect(
        contextFrom("[ITEM_1]\nhrs=1\nrate=1").getVariable(
          "total_recurring_due"
        )
      ).toBe("");
      expect(
        contextFrom("[ITEM_1]\nrecurring=0").getVariable("total_recurring_due")
      ).toBe("");
    });

    it("has a recurring total when only expenses recur", () => {
      expect(
        contextFrom("[ITEM_1]\nhrs=1\n[EXPENSE_1]\nrecurring=2").getVariable(
          "total_recurring_due"
        )
      ).toBe("2.00");
    });

    it("skips items that have no subtotal", () => {
      const ctx = contextFrom(
        lines("[ITEM_1]", "description=Free", "[ITEM_2]", "hrs=1", "rate=4")
      );
      expect(ctx.getVariable("total_due")).toBe("4.00");
    });

    it("uses provided subtotals", () => {
      const ctx = contextFrom("[ITEM_1]\nsubtotal=12.34");
      expect(ctx.getVariable("total_due")).toBe("12.34");
    });

    it("adds up recurring amounts", () => {
      const ctx = contextFrom(
        lines(
          "[ITEM_1]",
          "recurring=7",
          "[ITEM_2]",
          "recurring=4.5",
          "[EXPENSE_1]",
          "recurring=1"
        )
      );
      expect(ctx.getVariable("total_recurring_due")).toBe("12.50");
      expect(ctx.getVariable("ALL_ITEMS.total_recurring_due")).toBe("11.50");
      expect(ctx.getVariable("ALL_EXPENSES.total_recurring_due")).toBe("1.00");
    });

    it("does not overwrite totals provided in META", () => {
      const ctx = contextFrom(
        lines(
          "[META]",
          "total_due=999",
          "total_recurring_due=888",
          "[ITEM_1]",
          "hrs=1",
          "rate=1",
          "recurring=1"
        )
      );
      expect(ctx.getVariable("total_due")).toBe("999");
      expect(ctx.getVariable("total_recurring_due")).toBe("888");
      expect(ctx.getVariable("ALL_ITEMS.total_due")).toBe("1.00");
    });

    it("only skips the total that was provided", () => {
      const ctx = contextFrom(
        lines(
          "[META]",
          "total_due=999",
          "[ITEM_1]",
          "hrs=1",
          "rate=1",
          "recurring=3"
        )
      );
      expect(ctx.getVariable("total_due")).toBe("999");
      expect(ctx.getVariable("total_recurring_due")).toBe("3.00");
    });

    it("does not overwrite a total provided in the DEFAULT section", () => {
      const ctx = contextFrom(
        lines("[DEFAULT]", "total_due=5", "[ITEM_1]", "hrs=1", "rate=1")
      );
      expect(ctx.getVariable("total_due")).toBe("5");
    });
  });

  describe("ALL_<prefix>S sections", () => {
    it("joins every item's options with commas", () => {
      const ctx = contextFrom(
        lines("[ITEM_1]", "hrs=5", "rate=6", "[ITEM_2]", "hrs=2", "rate=3")
      );
      expect(ctx.getVariable("ALL_ITEMS.hrs")).toBe("5, 2");
      expect(ctx.getVariable("ALL_ITEMS.rate")).toBe("6, 3");
      expect(ctx.getVariable("ALL_ITEMS.total_due")).toBe("36.00");
    });

    it("is built from the options as written, before normalisation", () => {
      const ctx = contextFrom("[ITEM_1]\nhrs=5.5\nrate=2");
      expect(ctx.getVariable("ALL_ITEMS.hrs")).toBe("5.5");
      expect(ctx.getVariable("ALL_ITEMS.id")).toBe("");
      expect(ctx.getVariable("ALL_ITEMS.subtotal")).toBe("");
    });

    it("only lists options that items have", () => {
      const ctx = contextFrom(lines("[ITEM_1]", "hrs=5", "[ITEM_2]", "days=2"));
      expect(ctx.getVariable("ALL_ITEMS.hrs")).toBe("5");
      expect(ctx.getVariable("ALL_ITEMS.days")).toBe("2");
      expect(ctx.getVariable("ALL_ITEMS.rate")).toBe("");
    });

    it("has an empty recurring total when nothing recurs", () => {
      const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
      expect(ctx.getVariable("ALL_ITEMS.total_recurring_due")).toBe("");
    });

    it("has an empty recurring total when recurring amounts are zero", () => {
      const ctx = contextFrom("[ITEM_1]\nrecurring=0");
      expect(ctx.getVariable("ALL_ITEMS.total_recurring_due")).toBe("");
    });

    it("is not created when there are no items", () => {
      expect(contextFrom("").getVariable("ALL_ITEMS.total_due")).toBe("");
    });

    // Regression: when the section already exists its options are appended to
    // and no totals are written
    it("appends to a section that already exists without totals", () => {
      const ctx = contextFrom(
        lines("[ALL_ITEMS]", "hrs=1", "keep=me", "[ITEM_1]", "hrs=5", "rate=2")
      );
      expect(ctx.getVariable("ALL_ITEMS.hrs")).toBe("1, 5");
      expect(ctx.getVariable("ALL_ITEMS.rate")).toBe("2");
      expect(ctx.getVariable("ALL_ITEMS.keep")).toBe("me");
      expect(ctx.getVariable("ALL_ITEMS.total_due")).toBe("");
      expect(ctx.getVariable("total_due")).toBe("10.00");
    });

    it("appends to options inherited from the DEFAULT section", () => {
      const ctx = contextFrom(
        lines("[DEFAULT]", "currency=GBP", "[ITEM_1]", "hrs=1")
      );
      expect(ctx.getVariable("ALL_ITEMS.currency")).toBe("GBP, GBP");
    });
  });
});
