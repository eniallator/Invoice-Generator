import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { guardOrThrow, isArrayOf, isObjectOf, isString } from "deep-guards";
import { Option, raise } from "niall-utils";

const isDiagnostics = isArrayOf(isObjectOf({ message: isString }));

/** The pdf that goes with a typst file, next to it with the same name (whatever its extension) */
export const pdfPathFor = (typPath: string): string =>
  `${typPath.replace(/\.[^./\\]*$/, "")}.pdf`;

/** Compiles the typst file into a pdf, next to the typst file by default */
export const compilePdf = (
  typPath: string,
  pdfPath = pdfPathFor(typPath)
): string => {
  const main = resolve(typPath);
  const compiler = NodeCompiler.create({ workspace: dirname(main) });
  const result = compiler.compile({ mainFilePath: main });

  if (result.hasError()) {
    // There is always an error when it has one
    const error = Option.from(result.takeError()).getOrThrow();
    const diagnostics = guardOrThrow(
      compiler.fetchDiagnostics(error),
      isDiagnostics
    );
    raise(
      new Error(
        `Could not compile ${typPath}:\n${diagnostics.map(({ message }) => message).join("\n")}`
      )
    );
  }

  const document = Option.from(result.result).getOrThrow();
  writeFileSync(pdfPath, compiler.pdf(document));
  return pdfPath;
};
