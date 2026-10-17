// Process entry point: kept thin (the scripts are not covered by the tests)
// because it exits the process and shells out to latexmk. Everything else
// lives in testable modules under src.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { generateTex } from "../src/build.ts";
import { parseCli } from "../src/cli.ts";

const cli = parseCli(process.argv.slice(2));
if (cli.kind === "exit") {
  console.log(cli.message);
  process.exit(cli.exitCode);
}

const { cfg, template, outPath, keepAux } = cli;
generateTex(cfg, template, outPath);

const outDir = dirname(outPath);
const { error } = spawnSync(
  "latexmk",
  ["-pdf", "-interaction=nonstopmode", `-output-directory=${outDir}`, outPath],
  { stdio: "inherit" }
);
if (error !== undefined) throw error;

// Leave just the .tex and the pdf: latexmk's auxiliary files (.aux, .log,
// .synctex.gz etc.) are named after the .tex file, in the same directory
if (!keepAux) {
  const prefix = `${basename(outPath, ".tex")}.`;
  for (const file of readdirSync(outDir)) {
    if (file.startsWith(prefix) && ![".tex", ".pdf"].includes(extname(file))) {
      rmSync(join(outDir, file));
    }
  }
}
