import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { EOL } from "node:os";
import { join, resolve } from "node:path";
import { attempt } from "niall-utils";

// Text-mode semantics: newlines are normalised on read and expanded to the
// platform's on write
export const readText = (filePath: string): string =>
  readFileSync(filePath, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");

export const writeText = (filePath: string, contents: string): void => {
  writeFileSync(filePath, contents.replaceAll("\n", EOL));
};

export const isFile = (filePath: string): boolean =>
  attempt(
    () => statSync(filePath).isFile(),
    () => false
  );

export const realpath = (filePath: string): string => {
  const absolute = resolve(filePath);
  return attempt(
    () => realpathSync(absolute),
    () => absolute
  );
};

export const parseItemPath = (itemPath: string, basePath: string): string => {
  const first = itemPath[0];
  const unquoted =
    first !== undefined && "\"'".includes(first) && itemPath.endsWith(first)
      ? itemPath.slice(1, -1)
      : itemPath;
  return unquoted.startsWith(".")
    ? realpath(join(basePath, unquoted))
    : resolve(unquoted);
};
