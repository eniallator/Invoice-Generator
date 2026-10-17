// Generates a per-package API reference from the installed type declarations,
// so Claude can read the exact surface of the libraries this project uses.
//
// Packages come from the `claudeLibDocs` allowlist in package.json. Output goes
// to `.claude/lib-docs/<package>.md` (gitignored, regenerated on `pnpm install`).
//
// Never fails the install: problems are reported as warnings.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  guardOrThrow,
  isAnyRecord,
  isArrayOf,
  isInstance,
  isRecordOf,
  isString,
  isUnionOf,
  type Guard,
} from "deep-guards";
import { mapFilter, tuple } from "niall-utils";

type Json = Record<string, unknown>;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".claude", "lib-docs");

const isError = isInstance(Error);
const messageOf = (error: unknown) =>
  isError(error) ? error.message : String(error);

const readJson = (path: string): Json =>
  guardOrThrow(
    JSON.parse(readFileSync(path, "utf8")),
    isAnyRecord,
    `${path} is not a JSON object`
  );

/** The value at `key` if it passes `guard`, otherwise undefined. */
const field = <T>(json: Json, key: string, guard: Guard<T>) => {
  const value = json[key];
  return guard(value) ? value : undefined;
};

const posix = (path: string) => path.replaceAll("\\", "/");

/** Declaration file for an import specifier, e.g. "./x.js" -> "<dir>/x.d.ts" */
const resolveDeclaration = (fromDir: string, specifier: string) => {
  const base = resolve(fromDir, specifier.replace(/\.(?:[cm]?[jt]s)$/, ""));
  return [`${base}.d.ts`, join(base, "index.d.ts")].find(existsSync) ?? null;
};

/** Every `types` target in package.json, keyed by public import path. */
const typeEntries = (name: string, pkg: Json) => {
  const exportTargets = field(
    pkg,
    "exports",
    isRecordOf(isString, isUnionOf(isString, isAnyRecord))
  );
  const fromExports = mapFilter(
    Object.entries(exportTargets ?? {}),
    ([subpath, target]) => {
      const types = isString(target)
        ? undefined
        : field(target, "types", isString);
      return types === undefined
        ? null
        : tuple(subpath === "." ? name : `${name}/${subpath.slice(2)}`, types);
    }
  );
  const rootTypes =
    field(pkg, "types", isString) ?? field(pkg, "typings", isString);
  return fromExports.length > 0 || rootTypes === undefined
    ? fromExports
    : [tuple(name, rootTypes)];
};

const relativeSpecifiers = (source: string) =>
  mapFilter(
    [...source.matchAll(/\bfrom\s+["'](\.[^"']*)["']/g)],
    match => match[1]
  );

/** Depth-first crawl, so files appear next to the barrel that exports them. */
const crawl = (entryFiles: string[]) => {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const dir = dirname(file);
    for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
      const next = resolveDeclaration(dir, specifier);
      if (next !== null) visit(next);
    }
  };
  entryFiles.forEach(visit);
  return [...seen];
};

const tidy = (source: string) =>
  source
    .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
    .replace(/^export \{\};?$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const render = (name: string) => {
  const pkgDir = join(root, "node_modules", name);
  const pkg = readJson(join(pkgDir, "package.json"));
  const entries = typeEntries(name, pkg);
  const entryFiles = entries.map(([, types]) => resolve(pkgDir, types));
  const missing = entryFiles.filter(file => !existsSync(file));
  if (entries.length === 0 || missing.length > 0) {
    throw new Error("no usable type declarations");
  }

  const readme = ["README.md", "readme.md"].find(file =>
    existsSync(join(pkgDir, file))
  );
  const files = crawl(entryFiles).map(file => {
    const path = posix(relative(pkgDir, file));
    return `## ${path}\n\n\`\`\`ts\n${tidy(readFileSync(file, "utf8"))}\n\`\`\``;
  });

  return [
    `# ${name}@${field(pkg, "version", isString) ?? "unknown"}`,
    "",
    "Generated from the installed type declarations by `scripts/lib-docs.ts`. Do not edit.",
    "",
    `Import paths: ${entries.map(([path]) => `\`${path}\``).join(", ")}`,
    readme !== undefined
      ? `\nUsage prose: \`node_modules/${name}/${readme}\``
      : "",
    "",
    ...files.flatMap(file => [file, ""]),
  ].join("\n");
};

const main = () => {
  const allowlist = field(
    readJson(join(root, "package.json")),
    "claudeLibDocs",
    isArrayOf(isString)
  );
  rmSync(outDir, { recursive: true, force: true });
  if (allowlist === undefined || allowlist.length === 0) return;

  mkdirSync(outDir, { recursive: true });
  for (const name of allowlist) {
    try {
      writeFileSync(
        join(outDir, `${name.replaceAll("/", "__")}.md`),
        render(name)
      );
    } catch (error) {
      console.warn(`lib-docs: skipped ${name}: ${messageOf(error)}`);
    }
  }
};

try {
  main();
} catch (error) {
  console.warn(`lib-docs: failed: ${messageOf(error)}`);
}
