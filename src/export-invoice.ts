import { copyFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { isNonNullable, isOneOf, type TypeFromGuard } from "deep-guards";
import { raise } from "niall-utils";

import { renderTemplate } from "./build.ts";
import { isFile, writeText } from "./io.ts";
import { ContextVariables, type Item } from "./template/context-variables.ts";

const sectionText = (name: string, options: Item): string =>
  [
    `[${name}]`,
    "",
    ...[...options].map(
      ([key, value]) => `${key}=${value.replaceAll("\n", "\n    ")}`
    ),
    "",
  ].join("\n");

/**
 * The config as it was when the template was rendered with it: the imports
 * are merged, and what the template made it work out (the items' subtotals and
 * the totals) is written down. It can be used by itself, in place of the
 * original config and everything it imports.
 */
export const resolvedConfig = (cfg: string, template: string): string => {
  const variables = new ContextVariables(cfg);
  renderTemplate(cfg, template, variables);
  return [...variables.resolvedSections()]
    .map(([name, options]) => sectionText(name, options))
    .join("\n");
};

/** What the invoice's exported files are called, e.g. `janeRoe.2000.04.03` */
export const exportName = (cfg: string): string => basename(cfg, extname(cfg));

export interface ExportOptions {
  cfg: string;
  /** The template that the invoice was generated with */
  template: string;
  /** The pdf that `pnpm generate` made */
  pdfPath: string;
  pdfDir: string;
  cfgDir: string;
  overwrite: boolean;
  /** What to export, both the pdf and the config unless told otherwise */
  mode?: ExportMode;
}

export const isExportMode = isOneOf("both", "pdf", "cfg");
export type ExportMode = TypeFromGuard<typeof isExportMode>;

/**
 * Copies the invoice's pdf into `pdfDir`, and writes its resolved config into
 * `cfgDir`. Returns where each was exported to, or null if the mode left it out.
 */
export const exportInvoice = ({
  cfg,
  template,
  pdfPath,
  pdfDir,
  cfgDir,
  overwrite,
  mode = "both",
}: ExportOptions): { pdf: string | null; cfg: string | null } => {
  const name = exportName(cfg);
  const pdf = mode === "cfg" ? null : join(pdfDir, `${name}.pdf`);
  const resolvedPath = mode === "pdf" ? null : join(cfgDir, `${name}.cfg`);

  if (pdf !== null && !isFile(pdfPath)) {
    raise(
      new Error(`${pdfPath} does not exist, run pnpm generate ${cfg} first`)
    );
  }
  const existing = [pdf, resolvedPath].filter(isNonNullable).filter(isFile);
  if (existing.length > 0 && !overwrite) {
    raise(
      new Error(
        `Already exported, use --overwrite to replace:\n${existing.join("\n")}`
      )
    );
  }

  // Resolve first, so that a config that does not work exports nothing
  const resolved = resolvedPath === null ? null : resolvedConfig(cfg, template);
  if (pdf !== null) {
    mkdirSync(pdfDir, { recursive: true });
    copyFileSync(pdfPath, pdf);
  }
  if (resolvedPath !== null && resolved !== null) {
    mkdirSync(cfgDir, { recursive: true });
    writeText(resolvedPath, resolved);
  }
  return { pdf, cfg: resolvedPath };
};
