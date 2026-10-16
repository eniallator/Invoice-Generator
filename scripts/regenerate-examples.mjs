// Regenerates the example .tex and pdf files by running `pnpm generate` on the
// example configs (so it needs latexmk installed). Run this after changing a
// template or the generator, the examples test fails while the committed .tex
// files are out of date.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

const EXAMPLES = [
  [
    "raw_invoices/johnDoe.2000.01.01.cfg",
    "invoice_template.tex",
    "example_invoice.tex",
  ],
  [
    "raw_quotes/johnDoe.2000.01.01.cfg",
    "quote_template.tex",
    "example_quote.tex",
  ],
];

for (const [cfg, template, output] of EXAMPLES) {
  // pnpm is a .cmd file on Windows, which needs a shell. The arguments are the
  // constants above, relative to the root, so there is nothing to escape
  const { error, status } = spawnSync(
    "pnpm",
    ["generate", cfg, "--template", template, "--out-path", output],
    { cwd: root, stdio: "inherit", shell: true }
  );
  if (error !== undefined) throw error;
  if (status !== 0) {
    throw new Error(`pnpm generate failed for ${output} (exit code ${status})`);
  }
}
