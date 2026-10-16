import { dirname } from "node:path";
import { raise } from "niall-utils";

import { Config } from "./config.ts";
import { parseItemPath, realpath } from "./io.ts";

export const META = "META";

const IMPORT_SEPARATOR = "\n";

/**
 * Reads the config at `basePath` along with everything it imports (via
 * `META.import`). Imported values are overridden by the importing file, so the
 * entry point always wins.
 */
export const loadConfig = (basePath: string): Config => {
  const config = new Config();
  config.addSection(META);

  const importStack = [realpath(basePath)];
  const seenImports = new Set(importStack);
  const erroredImports = new Set<string>();
  let baseConfig: Config | undefined;

  for (
    let importPath = importStack.pop();
    importPath !== undefined;
    importPath = importStack.pop()
  ) {
    const imported = Config.read(importPath);
    if (imported === undefined) {
      erroredImports.add(importPath);
      continue;
    }

    if (baseConfig === undefined) baseConfig = imported;
    else config.merge(imported);

    const dir = dirname(importPath);
    const newImports = (imported.get(META, "import") ?? "")
      .split(IMPORT_SEPARATOR)
      .filter(name => name !== "" && !seenImports.has(name))
      .map(name => parseItemPath(`${name}.cfg`, dir));
    config.set(META, "import", "");
    for (const newImport of newImports.reverse()) {
      seenImports.add(newImport);
      importStack.push(newImport);
    }
  }

  if (baseConfig !== undefined) config.merge(baseConfig);
  if (erroredImports.size > 0) {
    raise(
      new Error(
        `Could not import the following config files:\n${[...erroredImports].join("\n")}`
      )
    );
  }
  return config;
};
