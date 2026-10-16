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

    it("rejects more than one section separator", () => {
      expect(() => ctx.getVariable("A.B.C")).toThrow(
        "Invalid variable 'A.B.C': expected [section.]option"
      );
    });

    it("rejects empty parts between separators too", () => {
      expect(() => ctx.getVariable("A..B")).toThrow("Invalid variable 'A..B'");
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

    it("works for any prefix, including ones with underscores", () => {
      expect(itemsOf("[FOO_BAR_x]\nqty=2", "FOO_BAR")).toEqual([
        { id: "x", qty: "2" },
      ]);
    });

    it("is empty when no sections match", () => {
      expect(itemsOf("[META]\nx=1")).toEqual([]);
    });

    it("caches the result per prefix", () => {
      const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
      expect(ctx.calculateItems("ITEM")).toBe(ctx.calculateItems("ITEM"));
    });

    it("shares its result with the group variables", () => {
      const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
      const items = ctx.calculateItems("ITEM");
      ctx.getVariable("ITEM_total_due");
      expect(ctx.calculateItems("ITEM")).toBe(items);
    });

    it("rejects invalid numbers", () => {
      expect(() => itemsOf("[ITEM_1]\nhrs=1.x\nrate=1")).toThrow(
        "could not convert string to float: '1.x'"
      );
      expect(() => itemsOf("[ITEM_1]\nsubtotal=lots")).toThrow(
        "could not convert string to float: 'lots'"
      );
      expect(() => itemsOf("[ITEM_1]\nrecurring=monthly")).toThrow(
        "could not convert string to float: 'monthly'"
      );
    });
  });

  describe("group variables", () => {
    describe("totals", () => {
      it("adds the item subtotals into <prefix>_total_due", () => {
        const ctx = contextFrom(
          lines("[ITEM_1]", "hrs=5", "rate=6", "[ITEM_2]", "hrs=2", "rate=3")
        );
        expect(ctx.getVariable("ITEM_total_due")).toBe("36.00");
      });

      it("works out each group separately", () => {
        const ctx = contextFrom(
          lines(
            "[ITEM_1]",
            "hrs=5",
            "rate=6",
            "[EXPENSE_1]",
            "qty=2",
            "price=10"
          )
        );
        expect(ctx.getVariable("ITEM_total_due")).toBe("30.00");
        expect(ctx.getVariable("EXPENSE_total_due")).toBe("20.00");
      });

      // Regression: there is no longer a combined total of everything
      it("has no combined total and no generated ALL_ sections", () => {
        const ctx = contextFrom("[ITEM_1]\nhrs=5\nrate=6");
        ctx.getVariable("ITEM_total_due");
        expect(ctx.getVariable("total_due")).toBe("");
        expect(ctx.getVariable("total_recurring_due")).toBe("");
        expect(ctx.getVariable("ALL_ITEMS.total_due")).toBe("");
      });

      it("skips items that have no subtotal", () => {
        const ctx = contextFrom(
          lines("[ITEM_1]", "description=Free", "[ITEM_2]", "hrs=1", "rate=4")
        );
        expect(ctx.getVariable("ITEM_total_due")).toBe("4.00");
      });

      it("uses provided subtotals", () => {
        const ctx = contextFrom("[ITEM_1]\nsubtotal=12.34");
        expect(ctx.getVariable("ITEM_total_due")).toBe("12.34");
      });

      it("adds up recurring amounts into <prefix>_total_recurring_due", () => {
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
        expect(ctx.getVariable("ITEM_total_recurring_due")).toBe("11.50");
        expect(ctx.getVariable("EXPENSE_total_recurring_due")).toBe("1.00");
      });

      // Regression: a recurring total of zero used to make
      // `when total_recurring_due` always true
      it("has no recurring total when nothing recurs", () => {
        expect(
          contextFrom("[ITEM_1]\nhrs=1\nrate=1").getVariable(
            "ITEM_total_recurring_due"
          )
        ).toBe("");
        expect(
          contextFrom("[ITEM_1]\nrecurring=0").getVariable(
            "ITEM_total_recurring_due"
          )
        ).toBe("");
      });
    });

    describe("joined options", () => {
      it("joins every item's option with commas", () => {
        const ctx = contextFrom(
          lines("[ITEM_1]", "hrs=5", "rate=6", "[ITEM_2]", "hrs=2", "rate=3")
        );
        expect(ctx.getVariable("ITEM_hrs")).toBe("5, 2");
        expect(ctx.getVariable("ITEM_rate")).toBe("6, 3");
      });

      it("is built from the options as written, before normalisation", () => {
        const ctx = contextFrom("[ITEM_1]\nhrs=5.5\nrate=2");
        expect(ctx.getVariable("ITEM_hrs")).toBe("5.5");
        expect(ctx.getVariable("ITEM_rate")).toBe("2");
        expect(ctx.getVariable("ITEM_id")).toBe("");
        expect(ctx.getVariable("ITEM_subtotal")).toBe("");
      });

      it("only joins the items that have the option", () => {
        const ctx = contextFrom(
          lines("[ITEM_1]", "hrs=5", "[ITEM_2]", "days=2")
        );
        expect(ctx.getVariable("ITEM_hrs")).toBe("5");
        expect(ctx.getVariable("ITEM_days")).toBe("2");
        expect(ctx.getVariable("ITEM_rate")).toBe("");
      });

      it("includes options inherited from the DEFAULT section", () => {
        const ctx = contextFrom(
          lines("[DEFAULT]", "currency=GBP", "[ITEM_1]", "hrs=1")
        );
        expect(ctx.getVariable("ITEM_currency")).toBe("GBP");
      });

      it("looks options up with the same case as the config", () => {
        // option names are lower cased when they are read
        const ctx = contextFrom("[ITEM_1]\nHrs=5");
        expect(ctx.getVariable("ITEM_hrs")).toBe("5");
      });
    });

    describe("resolving the name", () => {
      it("prefers the config when it has the variable", () => {
        const ctx = contextFrom(
          lines("[META]", "ITEM_total_due=999", "[ITEM_1]", "hrs=1", "rate=1")
        );
        expect(ctx.getVariable("ITEM_total_due")).toBe("999");
        expect(ctx.getVariable("ITEM_hrs")).toBe("1");
      });

      it("lives in META, so works with the explicit section too", () => {
        const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
        expect(ctx.getVariable("META.ITEM_total_due")).toBe("1.00");
        expect(ctx.getVariable("META.ITEM_hrs")).toBe("1");
        expect(ctx.getVariable("META.ITEM_total_due")).toBe(
          ctx.getVariable("ITEM_total_due")
        );
      });

      it("does not apply to other sections", () => {
        const ctx = contextFrom("[ITEM_1]\nhrs=1\nrate=1");
        expect(ctx.getVariable("OTHER.ITEM_total_due")).toBe("");
      });

      it("is empty for groups that do not exist", () => {
        const ctx = contextFrom("[ITEM_1]\nhrs=1");
        expect(ctx.getVariable("NOPE_total_due")).toBe("");
        expect(ctx.getVariable("EXPENSE_total_due")).toBe("");
        expect(ctx.getVariable("nounderscore")).toBe("");
        expect(ctx.getVariable("ITEM_")).toBe("");
        expect(ctx.getVariable("_ITEM")).toBe("");
        expect(ctx.getVariable("_a_b")).toBe("");
      });

      it("uses the longest prefix that is a group", () => {
        const ctx = contextFrom(
          lines(
            "[FOO_1]",
            "qty=1",
            "price=10",
            "[FOO_BAR_1]",
            "qty=3",
            "price=2"
          )
        );
        // FOO_BAR_1 is in both the FOO and FOO_BAR groups
        expect(ctx.getVariable("FOO_total_due")).toBe("16.00");
        expect(ctx.getVariable("FOO_BAR_total_due")).toBe("6.00");
        expect(ctx.getVariable("FOO_BAR_qty")).toBe("3");
        expect(ctx.getVariable("FOO_qty")).toBe("1, 3");
      });

      it("falls back to a shorter prefix when the longer one is not a group", () => {
        const ctx = contextFrom("[FOO_1]\nqty=1\nprice=10");
        expect(ctx.getVariable("FOO_total_due")).toBe("10.00");
        expect(ctx.getVariable("FOO_x_total_due")).toBe("");
      });
    });

    describe("laziness", () => {
      it("computes nothing until it is used", () => {
        expect(() => contextFrom("[ITEM_1]\nhrs=1.x\nrate=abc")).not.toThrow();
      });

      it("only computes the groups that are used", () => {
        const ctx = contextFrom(
          lines("[ITEM_1]", "hrs=1", "rate=1", "[BAD_1]", "rate=abc")
        );
        expect(ctx.getVariable("ITEM_total_due")).toBe("1.00");
        expect(() => ctx.getVariable("BAD_total_due")).toThrow(
          "could not convert string to float: 'abc'"
        );
      });

      it("does not depend on what has been used before", () => {
        const cfg = lines(
          "[ITEM_1]",
          "hrs=5",
          "rate=6",
          "[EXPENSE_1]",
          "qty=2",
          "price=10"
        );
        const forwards = contextFrom(cfg);
        const backwards = contextFrom(cfg);
        const names = ["ITEM_total_due", "EXPENSE_total_due", "ITEM_hrs"];
        expect(names.map(name => forwards.getVariable(name))).toEqual(
          names
            .toReversed()
            .map(name => backwards.getVariable(name))
            .toReversed()
        );
      });
    });
  });
});
