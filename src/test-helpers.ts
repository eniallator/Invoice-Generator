import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

import { ContextVariables } from "./context-variables.ts";
import { DynamicContentParser } from "./dynamic-content-parser.ts";

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export const lines = (...parts: string[]): string => parts.join("\n");

/** Writes the files (keyed by relative path) into a fresh temp dir and returns it */
export const createFiles = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "invoice-generator-"));
  createdDirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(dir, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return dir;
};

export const contextFrom = (
  cfg: string,
  files: Record<string, string> = {}
): ContextVariables =>
  new ContextVariables(
    join(createFiles({ "main.cfg": cfg, ...files }), "main.cfg")
  );

/** Renders `template` against `cfg` (as main.cfg), resolving file paths relative to the temp dir */
export const render = (
  template: string,
  cfg = "",
  files: Record<string, string> = {}
): string => {
  const dir = createFiles({ "main.cfg": cfg, ...files });
  return new DynamicContentParser(
    new ContextVariables(join(dir, "main.cfg")),
    dir
  ).parseString(template);
};
