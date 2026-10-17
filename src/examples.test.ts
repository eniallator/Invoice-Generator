// Integration tests: README "How It Works". The committed example invoice and
// quote must match what the generator produces from the example configs.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateTypst, renderTemplate } from "./build.ts";
import { readText } from "./io.ts";
import { compilePdf } from "./typst.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const inRoot = (...parts: string[]) => join(root, ...parts);

describe("example documents", () => {
  it("renders the example invoice from the example config", () => {
    expect(
      renderTemplate(
        inRoot("raw_invoices", "johnDoe.2000.01.01.cfg"),
        inRoot("invoice_template.typ")
      )
    ).toBe(readText(inRoot("example_invoice.typ")));
  });

  it("renders the example quote from the example config", () => {
    expect(
      renderTemplate(
        inRoot("raw_quotes", "johnDoe.2000.01.01.cfg"),
        inRoot("quote_template.typ")
      )
    ).toBe(readText(inRoot("example_quote.typ")));
  });

  it.each([
    ["invoice", "raw_invoices", "invoice_template.typ"],
    ["quote", "raw_quotes", "quote_template.typ"],
  ])("makes a pdf from the example %s", (name, cfgDir, template) => {
    const dir = mkdtempSync(join(tmpdir(), "invoice-generator-"));
    try {
      const typPath = join(dir, `${name}.typ`);
      generateTypst(
        inRoot(cfgDir, "johnDoe.2000.01.01.cfg"),
        inRoot(template),
        typPath
      );
      expect(existsSync(compilePdf(typPath))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
