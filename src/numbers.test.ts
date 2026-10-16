import { describe, expect, it } from "vitest";

import { formatFixed2, parseFloatOrNull, parseFloatStrict } from "./numbers.ts";

describe("parseFloatOrNull", () => {
  it.each([
    ["5", 5],
    ["5.", 5],
    [".5", 0.5],
    ["-2.50", -2.5],
    ["+1e3", 1000],
    ["2E-2", 0.02],
    ["  7  ", 7],
    ["007", 7],
  ])("parses %j as %d", (input, expected) => {
    expect(parseFloatOrNull(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "1.2.3", "5x", "1e", "--1", "."])(
    "returns null for %j",
    input => {
      expect(parseFloatOrNull(input)).toBeNull();
    }
  );
});

describe("parseFloatStrict", () => {
  it("parses valid floats", () => {
    expect(parseFloatStrict("12.5")).toBe(12.5);
  });

  it("throws, quoting the original input, for invalid floats", () => {
    expect(() => parseFloatStrict(" abc ")).toThrow(
      "could not convert string to float: ' abc '"
    );
  });
});

describe("formatFixed2", () => {
  it.each([
    [0, "0.00"],
    [5, "5.00"],
    [30, "30.00"],
    [1.5, "1.50"],
    [2.5, "2.50"],
    [1234.567, "1234.57"],
    [-3.2, "-3.20"],
    [0.0625, "0.06"],
  ])("formats %d as %s", (input, expected) => {
    expect(formatFixed2(input)).toBe(expected);
  });

  // Regression: Python's f"{x:.2f}" rounds exact binary ties to even, whereas
  // JS's toFixed rounds them up.
  it.each([
    [0.125, "0.12"],
    [0.375, "0.38"],
    [0.625, "0.62"],
    [0.875, "0.88"],
    [1.125, "1.12"],
    [-0.125, "-0.12"],
    [-0.375, "-0.38"],
  ])("rounds the exact tie %d to even (%s)", (input, expected) => {
    expect(formatFixed2(input)).toBe(expected);
  });

  // Regression: values that merely look like ties are not exact in binary and
  // keep their normal rounding
  it("does not treat inexact near-ties as ties", () => {
    expect(formatFixed2(2.675)).toBe("2.67");
    expect(formatFixed2(1.005)).toBe("1.00");
  });
});
