import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readText, writeText } from "./io.ts";
import { ContextVariables } from "./template/context-variables.ts";
import { DynamicContentParser } from "./template/dynamic-content-parser.ts";

/** Pass the `variables` to look at what rendering the template made them compute */
export const renderTemplate = (
  cfg: string,
  template: string,
  variables = new ContextVariables(cfg)
): string =>
  new DynamicContentParser(variables, resolve(dirname(template))).parseString(
    readText(template)
  );

export const generateTypst = (
  cfg: string,
  template: string,
  outPath: string
): void => {
  const rendered = renderTemplate(cfg, template);
  mkdirSync(dirname(outPath), { recursive: true });
  writeText(outPath, rendered);
};
