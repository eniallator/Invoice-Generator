import { describe, expect, it } from "vitest";

import {
  joinValues,
  mergeItems,
  normaliseItem,
  sumOption,
  type Item,
} from "./items.ts";

const item = (values: Record<string, string>): Item =>
  new Map(Object.entries(values));

const normalise = (values: Record<string, string>, id = "1") =>
  Object.fromEntries(normaliseItem(item(values), id));

describe("normaliseItem", () => {
  describe("id", () => {
    it("defaults to the given id", () => {
      expect(normalise({}, "ONE")).toEqual({ id: "ONE" });
    });

    it("keeps an explicit id", () => {
      expect(normalise({ id: "custom" }, "ONE").id).toBe("custom");
    });
  });

  describe("number formatting", () => {
    it("formats decimal numbers to two decimal places", () => {
      expect(
        normalise({
          hrs: "7.5",
          days: "1.0",
          qty: "2.255",
          rate: "10.5",
          price: "3.999",
        })
      ).toMatchObject({
        hrs: "7.50",
        days: "1.00",
        qty: "2.25",
        rate: "10.50",
        price: "4.00",
      });
    });

    // Regression: quantities are only reformatted when they contain a "."
    it("leaves whole number quantities exactly as written", () => {
      expect(normalise({ hrs: "5", days: "2", qty: "3" })).toMatchObject({
        hrs: "5",
        days: "2",
        qty: "3",
      });
    });

    // Regression: whole number prices must still be shown to two decimals
    // (they briefly stopped being formatted, unlike the README examples)
    it("always formats prices to two decimal places", () => {
      expect(normalise({ rate: "6", price: "3" })).toMatchObject({
        rate: "6.00",
        price: "3.00",
      });
    });

    it.each([
      ["a non-numeric rate", { rate: "pricey" }],
      ["an empty rate", { rate: "" }],
      ["a non-numeric price", { price: "pricey" }],
    ])("throws for %s", (_name, values) => {
      expect(() => normalise(values)).toThrow(
        "could not convert string to float"
      );
    });

    it("leaves other options untouched", () => {
      expect(normalise({ description: "1.5 apples" }).description).toBe(
        "1.5 apples"
      );
    });

    it("throws for decimals that are not numbers", () => {
      expect(() => normalise({ hrs: "1.x" })).toThrow(
        "could not convert string to float: '1.x'"
      );
    });
  });

  describe("subtotal", () => {
    it.each([
      ["hrs x rate", { hrs: "5", rate: "6" }, "30.00"],
      ["days x rate", { days: "2", rate: "100" }, "200.00"],
      ["qty x price", { qty: "3", price: "1.5" }, "4.50"],
      ["qty x rate", { qty: "2", rate: "10" }, "20.00"],
      ["hrs x price", { hrs: "2", price: "4" }, "8.00"],
      ["decimals", { hrs: "7.5", rate: "10" }, "75.00"],
    ])("is worked out from %s", (_name, values, expected) => {
      expect(normalise(values).subtotal).toBe(expected);
    });

    it("prefers hrs over days over qty, and rate over price", () => {
      expect(
        normalise({ hrs: "1", days: "2", qty: "3", rate: "10", price: "20" })
          .subtotal
      ).toBe("10.00");
      expect(
        normalise({ days: "2", qty: "3", rate: "10", price: "20" }).subtotal
      ).toBe("20.00");
      expect(normalise({ qty: "3", price: "20" }).subtotal).toBe("60.00");
    });

    it("keeps a provided subtotal exactly as written", () => {
      expect(normalise({ hrs: "5", rate: "6", subtotal: "12" }).subtotal).toBe(
        "12"
      );
    });

    it.each([
      ["no quantity", { rate: "6" }],
      ["no rate", { hrs: "5" }],
      ["a non-numeric quantity", { hrs: "lots", rate: "6" }],
      ["an empty quantity", { hrs: "", rate: "6" }],
      ["nothing", {}],
    ])("is omitted with %s", (_name, values) => {
      expect(normalise(values)).not.toHaveProperty("subtotal");
    });
  });

  describe("recurring", () => {
    it("is formatted to two decimal places", () => {
      expect(normalise({ recurring: "7" }).recurring).toBe("7.00");
      expect(normalise({ recurring: "7.5" }).recurring).toBe("7.50");
    });

    it("is not added when absent", () => {
      expect(normalise({ hrs: "1", rate: "1" })).not.toHaveProperty(
        "recurring"
      );
    });

    it("throws for non-numeric values", () => {
      expect(() => normalise({ recurring: "monthly" })).toThrow(
        "could not convert string to float: 'monthly'"
      );
    });
  });

  it("does not modify the item it is given", () => {
    const raw = item({ hrs: "5.5", rate: "2" });
    normaliseItem(raw, "1");
    expect(Object.fromEntries(raw)).toEqual({ hrs: "5.5", rate: "2" });
  });
});

describe("joinValues", () => {
  it("returns the value when there is nothing to join to", () => {
    expect(joinValues(undefined, "a")).toBe("a");
  });

  it("joins with a comma and space", () => {
    expect(joinValues("a", "b")).toBe("a, b");
  });

  it("joins onto empty strings too", () => {
    expect(joinValues("", "b")).toBe(", b");
  });
});

describe("mergeItems", () => {
  it("joins each option's values across the items", () => {
    expect(
      Object.fromEntries(
        mergeItems([
          item({ hrs: "5", rate: "6" }),
          item({ hrs: "2", rate: "3" }),
          item({ hrs: "1", rate: "1" }),
        ])
      )
    ).toEqual({ hrs: "5, 2, 1", rate: "6, 3, 1" });
  });

  it("only joins the items that have the option", () => {
    expect(
      Object.fromEntries(
        mergeItems([
          item({ hrs: "5" }),
          item({ recurring: "1" }),
          item({ hrs: "2", recurring: "3" }),
        ])
      )
    ).toEqual({ hrs: "5, 2", recurring: "1, 3" });
  });

  it("returns an empty item for no items", () => {
    expect(mergeItems([]).size).toBe(0);
  });
});

describe("sumOption", () => {
  it("adds up the option across the items", () => {
    expect(
      sumOption(
        [item({ subtotal: "30.00" }), item({ subtotal: "6.50" })],
        "subtotal"
      )
    ).toBe(36.5);
  });

  it("skips items without the option", () => {
    expect(
      sumOption(
        [item({ subtotal: "2" }), item({}), item({ subtotal: "3" })],
        "subtotal"
      )
    ).toBe(5);
  });

  it("is zero for no items", () => {
    expect(sumOption([], "subtotal")).toBe(0);
  });

  it("throws for values that are not numbers", () => {
    expect(() => sumOption([item({ subtotal: "n/a" })], "subtotal")).toThrow(
      "could not convert string to float: 'n/a'"
    );
  });
});
