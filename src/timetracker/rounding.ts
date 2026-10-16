import { raise } from "niall-utils";

const MINUTES_PER_HOUR = 60;

/** Parses the rounding threshold setting: whole minutes from 0 to 59 */
export const parseThresholdMinutes = (raw: string): number => {
  if (!/^\d{1,2}$/.test(raw.trim()) || Number(raw) >= MINUTES_PER_HOUR) {
    raise(
      new Error(
        `Invalid rounding threshold '${raw}': expected whole minutes from 0 to 59`
      )
    );
  }
  return Number(raw);
};

/**
 * Turns minutes worked (each an item, in date order) into whole hours.
 *
 * The month's total is rounded up to the next whole hour if the minutes past the
 * last whole hour are more than `thresholdMinutes`, and down otherwise. Every
 * item then starts rounded up, and the items with the fewest minutes past the
 * hour (the earliest one first when they are equal) are rounded down until the
 * hours add up to the month's total.
 */
export const roundHours = (
  minutes: number[],
  thresholdMinutes: number
): number[] => {
  const total = minutes.reduce((sum, item) => sum + item, 0);
  const monthHours =
    Math.floor(total / MINUTES_PER_HOUR) +
    (total % MINUTES_PER_HOUR > thresholdMinutes ? 1 : 0);

  const hours = minutes.map(item => Math.ceil(item / MINUTES_PER_HOUR));
  const excess = hours.reduce((sum, item) => sum + item, 0) - monthHours;
  const roundedDown = new Set(
    minutes
      .map((item, index) => ({ index, past: item % MINUTES_PER_HOUR }))
      .filter(({ past }) => past > 0)
      .toSorted((a, b) => a.past - b.past || a.index - b.index)
      .slice(0, excess)
      .map(({ index }) => index)
  );
  return hours.map((item, index) => (roundedDown.has(index) ? item - 1 : item));
};
