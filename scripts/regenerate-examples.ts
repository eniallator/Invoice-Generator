// Regenerates the example .typ and pdf files by running `pnpm generate` on the
// example configs. Run this after changing a template or the generator, the
// examples test fails while the committed .typ files are out of date.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tuple } from "niall-utils";

const root = join(import.meta.dirname, "..");

const EXAMPLES = [
  tuple(
    "raw_invoices/johnDoe.2000.01.01.cfg",
    "invoice_template.typ",
    "example_invoice.typ"
  ),
  tuple(
    "raw_quotes/johnDoe.2000.01.01.cfg",
    "quote_template.typ",
    "example_quote.typ"
  ),
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
