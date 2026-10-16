import { basename } from "node:path";
import { parseArgs } from "node:util";

export const USAGE = `Usage: pnpm generate <cfg> [options]

Generate an invoice

Arguments:
  cfg                    Config file to fill the invoice out with

Options:
  -t, --template <path>  LaTeX template file to use with the config variables
  -o, --out-path <path>  Output .tex path where to generate the auxiliary/tex/pdf
                         files. Use SAME to make the same as the config file name
                         (default: SAME)
  -q, --quote            In quote mode or not
  -h, --help             Show this help`;

export interface PathOptions {
  cfg: string;
  template: string | undefined;
  outPath: string;
  quote: boolean;
}

export const resolvePaths = ({
  cfg,
  template,
  outPath,
  quote,
}: PathOptions): { template: string; outPath: string } => {
  const cfgStem = basename(cfg).split(".").slice(0, -1).join(".");
  const defaultOutPath = quote ? "./out/quote.tex" : "./out/invoice.tex";
  return {
    template:
      template ?? (quote ? "./quote_template.tex" : "./invoice_template.tex"),
    outPath:
      outPath === "SAME"
        ? `./out/${cfgStem}.tex`
        : outPath === ""
          ? defaultOutPath
          : outPath,
  };
};

export type CliResult =
  | { kind: "run"; cfg: string; template: string; outPath: string }
  | { kind: "exit"; message: string; exitCode: number };

const parse = (argv: string[]) =>
  parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      template: { type: "string", short: "t" },
      "out-path": { type: "string", short: "o", default: "SAME" },
      quote: { type: "boolean", short: "q", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

export const parseCli = (argv: string[]): CliResult => {
  try {
    const { values, positionals } = parse(argv);
    const [cfg, ...extraPositionals] = positionals;
    if (values.help) return { kind: "exit", message: USAGE, exitCode: 0 };
    if (cfg === undefined || extraPositionals.length > 0) {
      return {
        kind: "exit",
        message: `${USAGE}\n\nExpected exactly one cfg`,
        exitCode: 2,
      };
    }
    return {
      kind: "run",
      cfg,
      ...resolvePaths({
        cfg,
        template: values.template,
        outPath: values["out-path"],
        quote: values.quote,
      }),
    };
  } catch (error) {
    return {
      kind: "exit",
      message: `${String(error)}\n\n${USAGE}`,
      exitCode: 2,
    };
  }
};
