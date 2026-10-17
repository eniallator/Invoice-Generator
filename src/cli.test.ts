import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseCli, resolvePaths, USAGE } from "./cli.ts";

const paths = (overrides: Partial<Parameters<typeof resolvePaths>[0]> = {}) =>
  resolvePaths({
    cfg: "./raw_invoices/johnDoe.2000.01.01.cfg",
    template: undefined,
    outPath: "SAME",
    quote: false,
    ...overrides,
  });

describe("resolvePaths", () => {
  it("names the output after the config file", () => {
    expect(paths().outPath).toBe("./out/johnDoe.2000.01.01.typ");
  });

  it("strips only the last extension and any directories", () => {
    expect(paths({ cfg: join("a", "b", "c.d.cfg") }).outPath).toBe(
      "./out/c.d.typ"
    );
    expect(paths({ cfg: "single.cfg" }).outPath).toBe("./out/single.typ");
  });

  it("uses an empty name for configs without an extension", () => {
    expect(paths({ cfg: "noextension" }).outPath).toBe("./out/.typ");
  });

  it("defaults to the invoice template", () => {
    expect(paths().template).toBe("./invoice_template.typ");
  });

  it("defaults to the quote template in quote mode", () => {
    expect(paths({ quote: true }).template).toBe("./quote_template.typ");
  });

  it("does not change SAME out paths in quote mode", () => {
    expect(paths({ quote: true }).outPath).toBe("./out/johnDoe.2000.01.01.typ");
  });

  it("lets an explicit template override quote mode", () => {
    expect(paths({ quote: true, template: "./mine.typ" }).template).toBe(
      "./mine.typ"
    );
  });

  it("uses an explicit out path as given", () => {
    expect(paths({ outPath: "build/final.typ" }).outPath).toBe(
      "build/final.typ"
    );
    expect(paths({ outPath: "build/final.typ", quote: true }).outPath).toBe(
      "build/final.typ"
    );
  });

  it("falls back to the default file names for an empty out path", () => {
    expect(paths({ outPath: "" }).outPath).toBe("./out/invoice.typ");
    expect(paths({ outPath: "", quote: true }).outPath).toBe("./out/quote.typ");
  });
});

describe("parseCli", () => {
  it("runs with just a config file", () => {
    expect(parseCli(["cfg/x.cfg"])).toEqual({
      kind: "run",
      cfg: "cfg/x.cfg",
      template: "./invoice_template.typ",
      outPath: "./out/x.typ",
    });
  });

  it("supports the short options", () => {
    expect(parseCli(["-q", "-t", "t.typ", "-o", "o.typ", "x.cfg"])).toEqual({
      kind: "run",
      cfg: "x.cfg",
      template: "t.typ",
      outPath: "o.typ",
    });
  });

  it("supports the long options", () => {
    expect(
      parseCli(["--quote", "--template=t.typ", "--out-path", "o.typ", "x.cfg"])
    ).toEqual({
      kind: "run",
      cfg: "x.cfg",
      template: "t.typ",
      outPath: "o.typ",
    });
  });

  it("supports options after the config file", () => {
    expect(parseCli(["x.cfg", "-q"])).toEqual({
      kind: "run",
      cfg: "x.cfg",
      template: "./quote_template.typ",
      outPath: "./out/x.typ",
    });
  });

  it("supports SAME as an explicit out path", () => {
    expect(parseCli(["-o", "SAME", "x.cfg"])).toMatchObject({
      outPath: "./out/x.typ",
    });
  });

  it.each([["-h"], ["--help"], ["x.cfg", "--help"]])(
    "prints the usage for %j",
    (...argv) => {
      expect(parseCli(argv)).toEqual({
        kind: "exit",
        message: USAGE,
        exitCode: 0,
      });
    }
  );

  it("fails without a config file", () => {
    expect(parseCli([])).toEqual({
      kind: "exit",
      message: `${USAGE}\n\nExpected exactly one cfg`,
      exitCode: 2,
    });
  });

  it("fails with more than one config file", () => {
    expect(parseCli(["a.cfg", "b.cfg"])).toMatchObject({
      kind: "exit",
      exitCode: 2,
      message: expect.stringContaining("Expected exactly one cfg") as string,
    });
  });

  it("fails with unknown options, explaining why", () => {
    const result = parseCli(["--bogus", "x.cfg"]);
    expect(result).toMatchObject({ kind: "exit", exitCode: 2 });
    expect(result).toMatchObject({
      message: expect.stringMatching(/bogus[\s\S]*Usage:/) as string,
    });
  });

  it("fails when an option is missing its value", () => {
    expect(parseCli(["x.cfg", "--template"])).toMatchObject({
      kind: "exit",
      exitCode: 2,
    });
  });
});
