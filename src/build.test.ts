import { existsSync, readFileSync } from "node:fs";
import { EOL } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { generateTex, renderTemplate } from "./build.ts";
import { createFiles, lines } from "./test-helpers.ts";

const FILES = {
  "main.cfg": lines("[META]", "name=World", "[ITEM_1]", "hrs=2", "rate=5"),
  "templates/template.tex": lines(
    "Hello {{ name }}!",
    "{* map ./item.tex ITEM */}",
    "Total: {{ ITEM_total_due }}"
  ),
  "templates/item.tex": "{{ ITEM.id }}={{ ITEM.subtotal }}\n",
};

describe("renderTemplate", () => {
  it("renders the template with the config's variables", () => {
    const dir = createFiles(FILES);
    expect(
      renderTemplate(join(dir, "main.cfg"), join(dir, "templates/template.tex"))
    ).toBe("Hello World!\n1=10.00\n\nTotal: 10.00");
  });

  it("resolves contents files relative to the template, not the config", () => {
    const dir = createFiles({
      ...FILES,
      "item.tex": "WRONG",
    });
    expect(
      renderTemplate(join(dir, "main.cfg"), join(dir, "templates/template.tex"))
    ).toContain("1=10.00");
  });

  it("normalises the template's line endings", () => {
    const dir = createFiles({
      "main.cfg": "",
      "t.tex": "a\r\nb\r\n",
    });
    expect(renderTemplate(join(dir, "main.cfg"), join(dir, "t.tex"))).toBe(
      "a\nb\n"
    );
  });

  it("throws for a missing template", () => {
    const dir = createFiles({ "main.cfg": "" });
    expect(() =>
      renderTemplate(join(dir, "main.cfg"), join(dir, "nope.tex"))
    ).toThrow();
  });
});

describe("generateTex", () => {
  it("writes the rendered template, creating the output directory", () => {
    const dir = createFiles(FILES);
    const outPath = join(dir, "deeply", "nested", "out.tex");
    generateTex(
      join(dir, "main.cfg"),
      join(dir, "templates/template.tex"),
      outPath
    );
    expect(readFileSync(outPath, "utf8")).toBe(
      ["Hello World!", "1=10.00", "", "Total: 10.00"].join(EOL)
    );
  });

  it("overwrites existing output", () => {
    const dir = createFiles({ ...FILES, "out.tex": "old" });
    const outPath = join(dir, "out.tex");
    generateTex(
      join(dir, "main.cfg"),
      join(dir, "templates/template.tex"),
      outPath
    );
    expect(readFileSync(outPath, "utf8")).not.toContain("old");
  });

  it("does not write anything if rendering fails", () => {
    const dir = createFiles({ "main.cfg": "", "t.tex": "{* when x *}" });
    const outPath = join(dir, "out", "out.tex");
    expect(() => {
      generateTex(join(dir, "main.cfg"), join(dir, "t.tex"), outPath);
    }).toThrow();
    expect(existsSync(join(dir, "out"))).toBe(false);
  });
});
