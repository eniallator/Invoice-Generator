import { describe, expect, it } from "vitest";

import { parseThresholdMinutes, roundHours } from "./rounding.ts";

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

describe("parseThresholdMinutes", () => {
  it.each([
    ["0", 0],
    ["30", 30],
    ["59", 59],
    ["7", 7],
    [" 15 ", 15],
    ["05", 5],
  ])("accepts %j", (raw, expected) => {
    expect(parseThresholdMinutes(raw)).toBe(expected);
  });

  it.each(["", " ", "60", "99", "100", "-1", "1.5", "abc", "0x1e", "30m"])(
    "rejects %j",
    raw => {
      expect(() => parseThresholdMinutes(raw)).toThrow(
        `Invalid rounding threshold '${raw}': expected whole minutes from 0 to 59`
      );
    }
  );
});

describe("roundHours", () => {
  describe("the month's total", () => {
    it("rounds up when the minutes past the hour are over the threshold", () => {
      // 7h55 in one item
      expect(roundHours([475], 30)).toEqual([8]);
    });

    it("rounds down when the minutes past the hour are under the threshold", () => {
      // 7h10
      expect(roundHours([430], 30)).toEqual([7]);
    });

    it("rounds down when they are exactly the threshold", () => {
      // 7h30
      expect(roundHours([450], 30)).toEqual([7]);
      expect(roundHours([451], 30)).toEqual([8]);
    });

    it("rounds the total, not each item", () => {
      // 5 x 7h10 = 35h50, which rounds up to 36h even though each rounds down.
      // The items are tied, so the earlier ones are the ones rounded down
      expect(roundHours([430, 430, 430, 430, 430], 30)).toEqual([
        7, 7, 7, 7, 8,
      ]);
    });

    it("works at the extremes of the threshold", () => {
      expect(roundHours([1], 0)).toEqual([1]);
      expect(roundHours([59], 59)).toEqual([0]);
      expect(roundHours([60], 59)).toEqual([1]);
    });
  });

  describe("sharing the hours between items", () => {
    it("rounds down the item with the fewest minutes past the hour", () => {
      // 7h55 + 7h40 + 7h10 = 22h45, which rounds up to 23h
      expect(roundHours([475, 460, 430], 30)).toEqual([8, 8, 7]);
    });

    it("rounds down as many items as it needs to", () => {
      // 4 x 7h15 = 29h, so 3 of the 4 items rounded up to 8h must go down
      expect(roundHours([435, 435, 435, 435], 30)).toEqual([7, 7, 7, 8]);
      // 4 x 7h45 = 31h, so only 1 must
      expect(roundHours([465, 465, 465, 465], 30)).toEqual([7, 8, 8, 8]);
    });

    it("breaks ties by rounding down the earliest item first", () => {
      expect(roundHours([450, 450], 30)).toEqual([7, 8]);
      expect(roundHours([480, 450, 450], 30)).toEqual([8, 7, 8]);
    });

    it("never changes items that are already whole hours", () => {
      expect(roundHours([480, 420, 450, 450], 30)).toEqual([8, 7, 7, 8]);
      expect(roundHours([480, 420], 30)).toEqual([8, 7]);
    });

    it("keeps the order of the items", () => {
      expect(roundHours([430, 475, 460], 30)).toEqual([7, 8, 8]);
    });

    it("can round an item down to nothing", () => {
      // 20 min + 20 min + 20 min = 1h, so two of the three go down to 0
      expect(roundHours([20, 20, 20], 30)).toEqual([0, 0, 1]);
    });
  });

  describe("edge cases", () => {
    it("handles no items", () => {
      expect(roundHours([], 30)).toEqual([]);
    });

    it("handles items with no time", () => {
      expect(roundHours([0], 30)).toEqual([0]);
      expect(roundHours([0, 0], 30)).toEqual([0, 0]);
    });

    it("does not change the input", () => {
      const minutes = [475, 460, 430];
      roundHours(minutes, 30);
      expect(minutes).toEqual([475, 460, 430]);
    });
  });

  // A seeded generator, so a failure is reproducible
  describe("for lots of random months", () => {
    const random = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const cases = Array.from({ length: 3000 }, (_, index) => {
      const next = random(index);
      const minutes = Array.from({ length: Math.floor(next() * 14) }, () =>
        // Some whole hours, and some short days
        next() < 0.2 ? Math.floor(next() * 10) * 60 : Math.floor(next() * 601)
      );
      const threshold = Math.floor(next() * 60);
      return { minutes, threshold, result: roundHours(minutes, threshold) };
    });

    it("adds up to the month's total rounded by the threshold", () => {
      for (const { minutes, threshold, result } of cases) {
        const total = sum(minutes);
        const expected =
          Math.floor(total / 60) + (total % 60 > threshold ? 1 : 0);
        expect(sum(result)).toBe(expected);
      }
    });

    it("rounds every item either up or down", () => {
      for (const { minutes, result } of cases) {
        expect(result).toHaveLength(minutes.length);
        for (const [index, hours] of result.entries()) {
          const item = minutes[index] ?? NaN;
          expect([Math.floor(item / 60), Math.ceil(item / 60)]).toContain(
            hours
          );
        }
      }
    });

    it("rounds down the items with the fewest minutes past the hour", () => {
      for (const { minutes, result } of cases) {
        const down: number[] = [];
        const up: number[] = [];
        for (const [index, item] of minutes.entries()) {
          if (item % 60 === 0) continue;
          (result[index] === Math.floor(item / 60) ? down : up).push(index);
        }
        for (const d of down) {
          for (const u of up) {
            const past = (index: number) => (minutes[index] ?? 0) % 60;
            // Nothing rounded up has fewer minutes past the hour, or the same
            // number but earlier
            expect(past(u) > past(d) || (past(u) === past(d) && u > d)).toBe(
              true
            );
          }
        }
      }
    });

    it("is deterministic", () => {
      for (const { minutes, threshold, result } of cases) {
        expect(roundHours(minutes, threshold)).toEqual(result);
      }
    });
  });
});
