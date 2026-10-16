// Integration tests: README "How It Works". The committed example invoice and
// quote must match what the generator produces from the example configs.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { renderTemplate } from "./build.ts";
import { readText } from "./io.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const inRoot = (...parts: string[]) => join(root, ...parts);

describe("example documents", () => {
  it("renders the example invoice from the example config", () => {
    expect(
      renderTemplate(
        inRoot("raw_invoices", "johnDoe.2000.01.01.cfg"),
        inRoot("invoice_template.tex")
      )
    ).toBe(readText(inRoot("example_invoice.tex")));
  });

  it("renders the example quote from the example config", () => {
    expect(
      renderTemplate(
        inRoot("raw_quotes", "johnDoe.2000.01.01.cfg"),
        inRoot("quote_template.tex")
      )
    ).toBe(readText(inRoot("example_quote.tex")));
  });
});
