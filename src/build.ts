import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ContextVariables } from "./context-variables.ts";
import { DynamicContentParser } from "./dynamic-content-parser.ts";
import { readText, writeText } from "./io.ts";

export const renderTemplate = (cfg: string, template: string): string =>
  new DynamicContentParser(
    new ContextVariables(cfg),
    resolve(dirname(template))
  ).parseString(readText(template));

export const generateTex = (
  cfg: string,
  template: string,
  outPath: string
): void => {
  const rendered = renderTemplate(cfg, template);
  mkdirSync(dirname(outPath), { recursive: true });
  writeText(outPath, rendered);
};
