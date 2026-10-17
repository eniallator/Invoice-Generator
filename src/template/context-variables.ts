import { memoize, raise } from "niall-utils";

import type { Config } from "../config/config.ts";
import { loadConfig, META } from "../config/imports.ts";
import { formatFixed2 } from "../numbers.ts";
import { mergeItems, normaliseItem, sumOption, type Item } from "./items.ts";

export type { Item } from "./items.ts";
export type Extra = ReadonlyMap<string, Item>;

interface Group {
  items: Item[];
  /** The group's precomputed variables, e.g. `total_due` and the joined `hrs` */
  values: Item;
}

const groupValues = (raw: readonly Item[], items: readonly Item[]): Item => {
  if (items.length === 0) return new Map();
  const totalRecurring = sumOption(items, "recurring");
  return new Map([
    ...mergeItems(raw),
    ["total_due", formatFixed2(sumOption(items, "subtotal"))],
    [
      "total_recurring_due",
      totalRecurring > 0 ? formatFixed2(totalRecurring) : "",
    ],
  ]);
};

/**
 * Holds the variables that templates can use. Nothing is computed until it is
 * asked for: a group of `<prefix>_<id>` sections (e.g. `ITEM_1`, `ITEM_2`) is
 * only worked out the first time it is mapped over or one of its variables is
 * used, and the config itself is never modified after it has been loaded.
 */
export class ContextVariables {
  private readonly config: Config;

  constructor(basePath: string) {
    this.config = loadConfig(basePath);
  }

  /** The items of every section named `<prefix>_<id>`, in alphabetical order */
  calculateItems(prefix: string): Item[] {
    return this.group(prefix).items;
  }

  /**
   * Looks up `section.option`, or `option` in META. Anything in META that is not
   * in the config can also be a group variable, so `ITEM_total_due` is the same
   * as `META.ITEM_total_due`: `<prefix>_total_due`,
   * `<prefix>_total_recurring_due` or `<prefix>_<option>`, which is every item's
   * value for that option joined with commas (e.g. `ITEM_hrs`).
   */
  getVariable(varId: string, extra: Extra = new Map()): string {
    const separator = varId.indexOf(".");
    const section = separator === -1 ? META : varId.slice(0, separator);
    const option = varId.slice(separator + 1);
    if (option.includes(".")) {
      raise(
        new Error(`Invalid variable '${varId}': expected [section.]option`)
      );
    }
    return (
      extra.get(section)?.get(option) ??
      this.config.get(section, option) ??
      (section === META ? this.groupVariable(option) : undefined) ??
      ""
    );
  }

  private groupVariable(name: string): string | undefined {
    // The longest prefix is the most specific, so try it first: for
    // `FOO_BAR_total_due` that is the `FOO_BAR` group before the `FOO` group
    for (
      let end = name.lastIndexOf("_");
      end > 0;
      end = name.lastIndexOf("_", end - 1)
    ) {
      const group = this.group(name.slice(0, end));
      if (group.items.length > 0) return group.values.get(name.slice(end + 1));
    }
    return undefined;
  }

  private readonly group = memoize((prefix: string): Group => {
    const sectionPrefix = `${prefix}_`;
    const entries = this.config
      .sectionNames()
      .filter(section => section.startsWith(sectionPrefix))
      .sort()
      .map(section => ({
        raw: this.config.items(section),
        id: section.slice(sectionPrefix.length),
      }));
    const items = entries.map(({ raw, id }) => normaliseItem(raw, id));
    return {
      items,
      values: groupValues(
        entries.map(({ raw }) => raw),
        items
      ),
    };
  });
}
