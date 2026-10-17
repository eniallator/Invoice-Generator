import { raise } from "niall-utils";

export const parseFloatOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  // Number("") is 0, so empty text has to be ruled out before converting
  const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseFloatStrict = (value: string): number =>
  parseFloatOrNull(value) ??
  raise(new Error(`could not convert string to float: '${value}'`));

// Two decimal places, with a 5 in the third decimal place rounding up
export const formatFixed2 = (value: number): string =>
  (Math.round(value * 100) / 100).toFixed(2);
