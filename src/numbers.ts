import { isInteger } from "deep-guards";
import { positiveMod, raise } from "niall-utils";

const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export const parseFloatOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  return FLOAT_RE.test(trimmed) ? Number(trimmed) : null;
};

export const parseFloatStrict = (value: string): number =>
  parseFloatOrNull(value) ??
  raise(new Error(`could not convert string to float: '${value}'`));

// Two decimal places, rounding exact ties to even (e.g. 0.125 -> 0.12) rather
// than away from zero
export const formatFixed2 = (value: number): string => {
  const eighths = value * 8;
  if (isInteger(eighths) && positiveMod(eighths, 2) === 1) {
    const lower = Math.floor(value * 100);
    return ((lower + positiveMod(lower, 2)) / 100).toFixed(2);
  }
  return value.toFixed(2);
};
