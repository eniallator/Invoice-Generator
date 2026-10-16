// Process entry point: kept thin (and excluded from coverage) because it exits
// the process and shells out to latexmk. Everything else lives in testable
// modules.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { generateTex } from "./build.ts";
import { parseCli } from "./cli.ts";

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
  [
    "-synctex=1",
    "-interaction=nonstopmode",
    "-file-line-error",
    "-pdf",
    "-f",
    `-aux-directory=${outDir}`,
    `-output-directory=${outDir}`,
    outPath,
  ],
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
