// Process entry point: kept thin (and excluded from coverage) because it exits
// the process and shells out to latexmk. Everything else lives in testable
// modules.
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

import { generateTex } from "./build.ts";
import { parseCli } from "./cli.ts";

const cli = parseCli(process.argv.slice(2));
if (cli.kind === "exit") {
  console.log(cli.message);
  process.exit(cli.exitCode);
}

const { cfg, template, outPath } = cli;
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
