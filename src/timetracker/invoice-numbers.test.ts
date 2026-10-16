import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isFile, readText } from "../io.ts";
import { createFiles } from "../test-helpers.ts";
import {
  incrementInvoiceId,
  lastInvoiceId,
  readInvoiceNumbers,
  writeInvoiceNumbers,
} from "./invoice-numbers.ts";

describe("incrementInvoiceId", () => {
  it.each([
    ["AB0041", "AB0042"],
    ["AB0009", "AB0010"],
    ["AB0099", "AB0100"],
    ["AB9999", "AB10000"],
    ["INV0001", "INV0002"],
    ["X1", "X2"],
    ["X9", "X10"],
    ["12", "13"],
    ["007", "008"],
    ["AB0041-v2", "AB0041-v3"],
    ["A1B0041", "A1B0042"],
  ])("%s -> %s", (id, expected) => {
    expect(incrementInvoiceId(id)).toBe(expected);
  });

  it.each(["", "AB", "AB12C", "12 "])("rejects %j", id => {
    expect(() => incrementInvoiceId(id)).toThrow(
      `Invoice id '${id}' does not end in a number`
    );
  });
});

describe("lastInvoiceId", () => {
  const invoice = (id: string) => `[META]\ninvoice_id=${id}\n`;

  it("uses the last id that was allocated if there is one", () => {
    const dir = createFiles({ "raw/a.cfg": invoice("AB0200") });
    expect(lastInvoiceId("AB0100", join(dir, "raw"))).toBe("AB0100");
  });

  it("otherwise uses the highest id in the raw invoices", () => {
    const dir = createFiles({
      "raw/a.cfg": invoice("AB0041"),
      "raw/b.cfg": invoice("AB0120"),
      "raw/c.cfg": invoice("AB0099"),
    });
    expect(lastInvoiceId(undefined, join(dir, "raw"))).toBe("AB0120");
  });

  it("compares the numbers, not the text", () => {
    const dir = createFiles({
      "raw/a.cfg": invoice("AB999"),
      "raw/b.cfg": invoice("AB1000"),
    });
    expect(lastInvoiceId(undefined, join(dir, "raw"))).toBe("AB1000");
  });

  it("ignores other files, other options and ids without a number", () => {
    const dir = createFiles({
      "raw/a.cfg": `[META]\nnot_invoice_id=AB0500\ninvoice_id=AB0030\n`,
      "raw/b.cfg": invoice("draft"),
      "raw/notes.txt": invoice("AB0900"),
    });
    expect(lastInvoiceId(undefined, join(dir, "raw"))).toBe("AB0030");
  });

  it("finds ids in the middle of a file and with spaces around them", () => {
    const dir = createFiles({
      "raw/a.cfg": `[META]\nimport=./default\ninvoice_id=AB0007  \ninvoice_date=2000/01/01\n`,
    });
    expect(lastInvoiceId(undefined, join(dir, "raw"))).toBe("AB0007");
  });

  it("throws if there is no id anywhere", () => {
    const dir = createFiles({ "raw/a.cfg": "[META]\ninvoice_terms=7 days\n" });
    expect(() => lastInvoiceId(undefined, join(dir, "raw"))).toThrow(
      /No invoice ids found in .*raw to continue from, so say which one to use with --invoice-id/
    );
  });
});

describe("readInvoiceNumbers", () => {
  const read = (contents: string) => {
    const dir = createFiles({ "numbers.json": contents });
    return () => readInvoiceNumbers(join(dir, "numbers.json"));
  };

  it("has used nothing if the file does not exist", () => {
    const dir = createFiles({ "other.txt": "" });
    expect(readInvoiceNumbers(join(dir, "numbers.json"))).toEqual({
      last: undefined,
      drafts: {},
    });
  });

  it("reads the last id and the draft ids", () => {
    expect(
      read(
        JSON.stringify({
          last: "AB0042",
          drafts: {
            "a.2000.01.01.cfg": "AB0041",
            "b.2000.01.01.cfg": "AB0042",
          },
        })
      )()
    ).toEqual({
      last: "AB0042",
      drafts: { "a.2000.01.01.cfg": "AB0041", "b.2000.01.01.cfg": "AB0042" },
    });
  });

  it.each([
    ["only the last id", { last: "AB0042" }, { last: "AB0042", drafts: {} }],
    [
      "only the drafts",
      { drafts: { "a.cfg": "AB0001" } },
      { last: undefined, drafts: { "a.cfg": "AB0001" } },
    ],
    ["nothing", {}, { last: undefined, drafts: {} }],
  ])("reads a file with %s", (_, data, expected) => {
    expect(read(JSON.stringify(data))()).toEqual(expected);
  });

  it.each([
    ["not JSON", "last: AB0042"],
    ["empty", ""],
    ["null", "null"],
    ["a string", '"AB0042"'],
    ["an array", "[]"],
    ["a last id that is not text", '{"last": 42}'],
    ["drafts that are null", '{"drafts": null}'],
    ["drafts that are an array", '{"drafts": ["AB0001"]}'],
    ["drafts that are text", '{"drafts": "AB0001"}'],
    ["a draft id that is not text", '{"drafts": {"a.cfg": 1}}'],
  ])("rejects a file that is %s", (_, contents) => {
    expect(read(contents)).toThrow(/numbers\.json is not valid, expected/);
  });
});

describe("writeInvoiceNumbers", () => {
  it("writes the numbers as JSON that can be read back", () => {
    const dir = createFiles({ "other.txt": "" });
    const path = join(dir, "numbers.json");
    const numbers = {
      last: "AB0042",
      drafts: { "a.2000.01.01.cfg": "AB0042" },
    };
    writeInvoiceNumbers(path, numbers);
    expect(readText(path)).toBe(
      `{\n  "last": "AB0042",\n  "drafts": {\n    "a.2000.01.01.cfg": "AB0042"\n  }\n}\n`
    );
    expect(readInvoiceNumbers(path)).toEqual(numbers);
  });

  it("leaves out a last id that is not set", () => {
    const dir = createFiles({ "other.txt": "" });
    const path = join(dir, "numbers.json");
    writeInvoiceNumbers(path, { last: undefined, drafts: {} });
    expect(readText(path)).toBe(`{\n  "drafts": {}\n}\n`);
    expect(readInvoiceNumbers(path)).toEqual({ last: undefined, drafts: {} });
  });

  it("replaces what was there, and creates the file", () => {
    const dir = createFiles({ "numbers.json": '{"last": "AB0001"}' });
    const path = join(dir, "numbers.json");
    writeInvoiceNumbers(path, { last: "AB0002", drafts: {} });
    expect(readInvoiceNumbers(path).last).toBe("AB0002");

    const fresh = join(dir, "fresh.json");
    expect(isFile(fresh)).toBe(false);
    writeInvoiceNumbers(fresh, { last: "AB0003", drafts: {} });
    expect(isFile(fresh)).toBe(true);
  });
});
