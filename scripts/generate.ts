// Process entry point: kept thin (the scripts are not covered by the tests)
// because it exits the process. Everything else lives in testable modules
// under src.
import { generateTypst } from "../src/build.ts";
import { parseCli } from "../src/cli.ts";
import { compilePdf } from "../src/typst.ts";

const cli = parseCli(process.argv.slice(2));
if (cli.kind === "exit") {
  console.log(cli.message);
  process.exit(cli.exitCode);
}

const { cfg, template, outPath } = cli;
generateTypst(cfg, template, outPath);
compilePdf(outPath);
