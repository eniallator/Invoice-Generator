// Process entry point: kept thin like generate.ts, as the scripts are not
// covered by the tests. Copies each generated invoice into the export folders.
// Run `pnpm generate` for the invoice first, so that its pdf exists.
import { parseArgs } from "node:util";
import { isNonNullable } from "deep-guards";

import { resolvePaths } from "../src/cli.ts";
import { loadEnv, requireEnv } from "../src/env.ts";
import { exportInvoice, isExportMode } from "../src/export-invoice.ts";
import { pdfPathFor } from "../src/typst.ts";

const USAGE = `Usage: pnpm export <cfg>... [options]

Copy the pdf of each invoice (the one that \`pnpm generate <cfg>\` makes) into
EXPORT_PDF_DIR, and its fully resolved config (the imports merged, and the
items and totals worked out) into EXPORT_CFG_DIR. Both are set in .env.

Options:
      --mode <mode>      What to export: pdf, cfg or both (default: both).
                         Only the pdf is needed for pdf, and only the config
                         for cfg, so cfg does not need \`pnpm generate\` first
  -t, --template <path>  The template that the invoice was generated with
  -q, --quote            The invoice is a quote
      --overwrite        Replace anything that was already exported
  -h, --help             Show this help`;

loadEnv();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "both" },
    template: { type: "string", short: "t" },
    quote: { type: "boolean", short: "q", default: false },
    overwrite: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help || positionals.length === 0) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}
const { mode } = values;
if (!isExportMode(mode)) {
  console.error(`--mode must be pdf, cfg or both, not "${mode}"\n\n${USAGE}`);
  process.exit(2);
}

const pdfDir = requireEnv("EXPORT_PDF_DIR");
const cfgDir = requireEnv("EXPORT_CFG_DIR");

for (const cfg of positionals) {
  const { template, outPath } = resolvePaths({
    cfg,
    template: values.template,
    outPath: "SAME",
    quote: values.quote,
  });
  const exported = exportInvoice({
    cfg,
    template,
    pdfPath: pdfPathFor(outPath),
    pdfDir,
    cfgDir,
    overwrite: values.overwrite,
    mode,
  });
  const files = [exported.pdf, exported.cfg].filter(isNonNullable);
  console.log(`${cfg}: exported ${files.join(" and ")}`);
}
