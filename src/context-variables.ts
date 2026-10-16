import { raise } from "niall-utils";

import type { Config } from "./config.ts";
import { loadConfig, META } from "./imports.ts";
import {
  joinValues,
  mergeItems,
  normaliseItem,
  sumOption,
  type Item,
} from "./items.ts";
import { formatFixed2 } from "./numbers.ts";

export type { Item } from "./items.ts";
export type Extra = ReadonlyMap<string, Item>;

export class ContextVariables {
  private readonly config: Config;
  private readonly builtItems = new Map<string, Item[]>();
  private readonly shouldTotalDue: boolean;
  private readonly shouldTotalRecurringDue: boolean;

  constructor(basePath: string) {
    this.config = loadConfig(basePath);
    this.shouldTotalDue = !this.config.hasOption(META, "total_due");
    this.shouldTotalRecurringDue = !this.config.hasOption(
      META,
      "total_recurring_due"
    );

    this.calculateItems("ITEM");
    this.calculateItems("EXPENSE");
  }

  calculateItems(prefix: string): Item[] {
    const cached = this.builtItems.get(prefix);
    if (cached !== undefined) return cached;

    const sectionPrefix = `${prefix}_`;
    const sections = this.config
      .sectionNames()
      .filter(section => section.startsWith(sectionPrefix))
      .sort();
    const entries = sections.map(section => ({
      raw: this.config.items(section),
      id: section.slice(sectionPrefix.length),
    }));
    const rawItems = entries.map(({ raw }) => raw);
    const items = entries.map(({ raw, id }) => normaliseItem(raw, id));
    this.builtItems.set(prefix, items);

    const total = sumOption(items, "subtotal");
    const totalRecurring = sumOption(items, "recurring");
    this.writeAllSection(`ALL_${prefix}S`, rawItems, total, totalRecurring);

    if (this.shouldTotalDue) this.addToMeta("total_due", total);
    if (this.shouldTotalRecurringDue && totalRecurring > 0) {
      this.addToMeta("total_recurring_due", totalRecurring);
    }
    return items;
  }

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
      extra.get(section)?.get(option) ?? this.config.get(section, option) ?? ""
    );
  }

  /** `ALL_<prefix>S` has every item's options joined together, plus the totals */
  private writeAllSection(
    allSection: string,
    rawItems: Item[],
    total: number,
    totalRecurring: number
  ): void {
    if (rawItems.length === 0) return;

    const alreadyExisted = this.config.contains(allSection);
    if (!this.config.hasSection(allSection)) this.config.addSection(allSection);

    for (const [key, value] of mergeItems(rawItems)) {
      this.config.set(
        allSection,
        key,
        joinValues(this.config.get(allSection, key), value)
      );
    }
    if (!alreadyExisted) {
      this.config.set(allSection, "total_due", formatFixed2(total));
      this.config.set(
        allSection,
        "total_recurring_due",
        totalRecurring > 0 ? formatFixed2(totalRecurring) : ""
      );
    }
  }

  private addToMeta(key: string, amount: number): void {
    this.config.set(
      META,
      key,
      formatFixed2(this.config.getFloat(META, key, 0) + amount)
    );
  }
}
