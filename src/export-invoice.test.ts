import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderTemplate } from "./build.ts";
import { exportInvoice, exportName, resolvedConfig } from "./export-invoice.ts";
import { createFiles, lines } from "./test-helpers.ts";

const TEMPLATE = lines(
  "{{ client }}",
  "/*% map ITEM >*/",
  "{{ ITEM.id }}: {{ ITEM.hrs }} x {{ ITEM.rate }} = {{ ITEM.subtotal }}",
  "/*< map %*/",
  "Total: {{ ITEM_total_due }}",
  "/*% when EXPENSE_total_due >*/With expenses: /*% add ITEM_total_due EXPENSE_total_due %*//*< when %*/"
);

const FILES = {
  "invoice.template.typ": TEMPLATE,
  "defaults.cfg": lines("[META]", "", "client=Jane Roe", "terms=7 days"),
  "janeRoe.2000.04.03.cfg": lines(
    "[META]",
    "",
    "import=./defaults",
    "invoice_id=AB0042",
    "",
    "[ITEM_1]",
    "description=Work",
    "hrs=5",
    "rate=6",
    "",
    "[ITEM_2]",
    "description=More work",
    "hrs=2.5",
    "rate=3",
    "",
    "[EXPENSE_1]",
    "description=Train",
    "subtotal=10",
    "",
    "[PAYMENT]",
    "bank=Super Cool Bank",
    "notes=first line",
    "  second line"
  ),
  "out/janeRoe.2000.04.03.pdf": "%PDF-fake",
};

const setup = () => {
  const dir = createFiles(FILES);
  return {
    dir,
    cfg: join(dir, "janeRoe.2000.04.03.cfg"),
    template: join(dir, "invoice.template.typ"),
    pdfPath: join(dir, "out", "janeRoe.2000.04.03.pdf"),
    pdfDir: join(dir, "exported", "invoices"),
    cfgDir: join(dir, "exported", "raw_invoices"),
  };
};

describe("exportName", () => {
  it("is the config's file name without its extension", () => {
    expect(exportName("./raw_invoices/janeRoe.2000.04.03.cfg")).toBe(
      "janeRoe.2000.04.03"
    );
  });
});

describe("resolvedConfig", () => {
  it("merges the imports and works out what the template used", () => {
    const { cfg, template } = setup();
    expect(resolvedConfig(cfg, template)).toBe(
      lines(
        "[META]",
        "",
        "client=Jane Roe",
        "terms=7 days",
        "invoice_id=AB0042",
        "ITEM_total_due=37.50",
        "EXPENSE_total_due=10.00",
        "",
        "[ITEM_1]",
        "",
        "description=Work",
        "hrs=5",
        "rate=6.00",
        "id=1",
        "subtotal=30.00",
        "",
        "[ITEM_2]",
        "",
        "description=More work",
        "hrs=2.50",
        "rate=3.00",
        "id=2",
        "subtotal=7.50",
        "",
        "[EXPENSE_1]",
        "",
        "description=Train",
        "subtotal=10.00",
        "id=1",
        "",
        "[PAYMENT]",
        "",
        "bank=Super Cool Bank",
        "notes=first line",
        "    second line",
        ""
      )
    );
  });

  it("renders the template the same as the config it was made from", () => {
    const { dir, cfg, template } = setup();
    const resolvedPath = join(dir, "resolved.cfg");
    writeFileSync(resolvedPath, resolvedConfig(cfg, template));
    expect(renderTemplate(resolvedPath, template)).toBe(
      renderTemplate(cfg, template)
    );
  });

  it("leaves out what the template did not use", () => {
    const { dir, cfg } = setup();
    const template = join(dir, "client.typ");
    writeFileSync(template, "{{ client }}");
    const resolved = resolvedConfig(cfg, template);
    expect(resolved).not.toContain("subtotal=30.00");
    expect(resolved).not.toContain("_total_due");
    expect(resolved).toContain("hrs=2.5\n");
  });
});

describe("exportInvoice", () => {
  it("copies the pdf and writes the resolved config", () => {
    const { cfg, template, pdfPath, pdfDir, cfgDir } = setup();
    const result = exportInvoice({
      cfg,
      template,
      pdfPath,
      pdfDir,
      cfgDir,
      overwrite: false,
    });

    expect(result).toEqual({
      pdf: join(pdfDir, "janeRoe.2000.04.03.pdf"),
      cfg: join(cfgDir, "janeRoe.2000.04.03.cfg"),
    });
    expect(readFileSync(join(pdfDir, "janeRoe.2000.04.03.pdf"), "utf8")).toBe(
      "%PDF-fake"
    );
    const written = readFileSync(
      join(cfgDir, "janeRoe.2000.04.03.cfg"),
      "utf8"
    );
    expect(written.replaceAll("\r\n", "\n")).toBe(
      resolvedConfig(cfg, template)
    );
    expect(written).toContain("ITEM_total_due=37.50");
  });

  it("only exports the pdf in pdf mode", () => {
    const { cfg, template, pdfPath, pdfDir, cfgDir } = setup();
    const result = exportInvoice({
      cfg,
      template,
      pdfPath,
      pdfDir,
      cfgDir,
      overwrite: false,
      mode: "pdf",
    });

    expect(result).toEqual({
      pdf: join(pdfDir, "janeRoe.2000.04.03.pdf"),
      cfg: null,
    });
    expect(existsSync(join(pdfDir, "janeRoe.2000.04.03.pdf"))).toBe(true);
    expect(existsSync(cfgDir)).toBe(false);
  });

  it("only exports the config in cfg mode, without needing the pdf", () => {
    const { cfg, template, dir, pdfDir, cfgDir } = setup();
    const result = exportInvoice({
      cfg,
      template,
      pdfPath: join(dir, "out", "missing.pdf"),
      pdfDir,
      cfgDir,
      overwrite: false,
      mode: "cfg",
    });

    expect(result).toEqual({
      pdf: null,
      cfg: join(cfgDir, "janeRoe.2000.04.03.cfg"),
    });
    expect(existsSync(pdfDir)).toBe(false);
  });

  it("only checks for the exports that the mode makes", () => {
    const { cfg, template, pdfPath, pdfDir, cfgDir } = setup();
    const options = { cfg, template, pdfPath, pdfDir, cfgDir };
    exportInvoice({ ...options, overwrite: false, mode: "pdf" });

    expect(
      exportInvoice({ ...options, overwrite: false, mode: "cfg" }).cfg
    ).toBe(join(cfgDir, "janeRoe.2000.04.03.cfg"));
    expect(() =>
      exportInvoice({ ...options, overwrite: false, mode: "pdf" })
    ).toThrow("Already exported");
  });

  it("throws if the invoice has not been generated", () => {
    const { cfg, template, dir, pdfDir, cfgDir } = setup();
    const missing = join(dir, "out", "missing.pdf");
    expect(() =>
      exportInvoice({
        cfg,
        template,
        pdfPath: missing,
        pdfDir,
        cfgDir,
        overwrite: false,
      })
    ).toThrow(`${missing} does not exist, run pnpm generate ${cfg} first`);
    expect(existsSync(pdfDir)).toBe(false);
  });

  it("will not replace what was already exported", () => {
    const { cfg, template, pdfPath, pdfDir, cfgDir } = setup();
    const options = { cfg, template, pdfPath, pdfDir, cfgDir };
    exportInvoice({ ...options, overwrite: false });
    writeFileSync(join(pdfDir, "janeRoe.2000.04.03.pdf"), "edited");

    expect(() => exportInvoice({ ...options, overwrite: false })).toThrow(
      "Already exported, use --overwrite to replace"
    );
    expect(readFileSync(join(pdfDir, "janeRoe.2000.04.03.pdf"), "utf8")).toBe(
      "edited"
    );
  });

  it("replaces what was already exported when told to", () => {
    const { cfg, template, pdfPath, pdfDir, cfgDir } = setup();
    const options = { cfg, template, pdfPath, pdfDir, cfgDir };
    exportInvoice({ ...options, overwrite: false });
    writeFileSync(join(pdfDir, "janeRoe.2000.04.03.pdf"), "edited");

    exportInvoice({ ...options, overwrite: true });
    expect(readFileSync(join(pdfDir, "janeRoe.2000.04.03.pdf"), "utf8")).toBe(
      "%PDF-fake"
    );
  });

  it("exports nothing for a config that does not work", () => {
    const { dir, template, pdfPath, pdfDir, cfgDir } = setup();
    const cfg = join(dir, "broken.cfg");
    writeFileSync(cfg, lines("[META]", "", "import=./nowhere"));
    expect(() =>
      exportInvoice({
        cfg,
        template,
        pdfPath,
        pdfDir,
        cfgDir,
        overwrite: false,
      })
    ).toThrow("Could not import");
    expect(existsSync(pdfDir)).toBe(false);
    expect(existsSync(cfgDir)).toBe(false);
  });
});
