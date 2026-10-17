import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFiles } from "./test-helpers.ts";
import { compilePdf, pdfPathFor } from "./typst.ts";

describe("pdfPathFor", () => {
  it("is next to the typst file, with the same name", () => {
    expect(pdfPathFor("./out/janeRoe.2000.04.03.typ")).toBe(
      "./out/janeRoe.2000.04.03.pdf"
    );
  });

  it("never makes the typst file's own path, whatever it is called", () => {
    expect(pdfPathFor("./out/invoice.tex")).toBe("./out/invoice.pdf");
    expect(pdfPathFor("./out/invoice")).toBe("./out/invoice.pdf");
    expect(pdfPathFor("./out.dir/invoice")).toBe("./out.dir/invoice.pdf");
  });
});

describe("compilePdf", () => {
  it("makes a pdf next to the typst file", () => {
    const dir = createFiles({ "doc.typ": "Hello *world*" });
    const pdf = compilePdf(join(dir, "doc.typ"));
    expect(pdf).toBe(join(dir, "doc.pdf"));
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("can make the pdf somewhere else", () => {
    const dir = createFiles({ "doc.typ": "Hello" });
    const pdf = compilePdf(join(dir, "doc.typ"), join(dir, "other.pdf"));
    expect(pdf).toBe(join(dir, "other.pdf"));
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("throws what is wrong with the typst file", () => {
    const dir = createFiles({ "doc.typ": "#not-a-thing" });
    expect(() => compilePdf(join(dir, "doc.typ"))).toThrow(
      /Could not compile .*doc\.typ:\nunknown variable: not-a-thing/
    );
  });
});
