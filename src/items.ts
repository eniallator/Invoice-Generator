import { formatFixed2, parseFloatOrNull, parseFloatStrict } from "./numbers.ts";

export type Item = Map<string, string>;

const JOIN_SEPARATOR = ", ";
// Quantities are only reformatted when written with a decimal point, whereas
// prices are always shown to 2dp
const QUANTITY_KEYS = ["hrs", "days", "qty"];
const PRICE_KEYS = ["rate", "price"];

const firstPresent = (item: Item, keys: string[]): string | undefined =>
  keys.map(key => item.get(key)).find(value => value !== undefined);

const computeSubtotal = (item: Item): string | undefined => {
  const quantity = parseFloatOrNull(
    firstPresent(item, ["hrs", "days", "qty"]) ?? ""
  );
  const unitPrice = parseFloatOrNull(
    firstPresent(item, ["rate", "price"]) ?? ""
  );
  return quantity === null || unitPrice === null
    ? undefined
    : formatFixed2(quantity * unitPrice);
};

/** Fills in the id, normalises numbers to 2dp and works out the subtotal */
export const normaliseItem = (raw: Item, defaultId: string): Item => {
  const item = new Map(raw);
  if (!item.has("id")) item.set("id", defaultId);

  for (const key of QUANTITY_KEYS) {
    const value = item.get(key);
    if (value?.includes(".")) {
      item.set(key, formatFixed2(parseFloatStrict(value)));
    }
  }
  for (const key of PRICE_KEYS) {
    const value = item.get(key);
    if (value !== undefined) {
      item.set(key, formatFixed2(parseFloatStrict(value)));
    }
  }

  const subtotal = item.get("subtotal") ?? computeSubtotal(item);
  if (subtotal !== undefined) item.set("subtotal", subtotal);

  const recurring = item.get("recurring");
  if (recurring !== undefined) {
    item.set("recurring", formatFixed2(parseFloatStrict(recurring)));
  }
  return item;
};

export const joinValues = (existing: string | undefined, value: string) =>
  existing === undefined ? value : existing + JOIN_SEPARATOR + value;

/** One item with every option's values joined across all the given items */
export const mergeItems = (items: readonly Item[]): Item => {
  const merged: Item = new Map();
  for (const item of items) {
    for (const [key, value] of item) {
      merged.set(key, joinValues(merged.get(key), value));
    }
  }
  return merged;
};

export const sumOption = (items: readonly Item[], key: string): number =>
  items.reduce((sum, item) => {
    const value = item.get(key);
    return value === undefined ? sum : sum + parseFloatStrict(value);
  }, 0);
