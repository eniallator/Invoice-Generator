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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, ".claude", "lib-docs");

const readJson = path => JSON.parse(readFileSync(path, "utf8"));
const posix = path => path.replaceAll("\\", "/");

/** Declaration file for an import specifier, e.g. "./x.js" -> "<dir>/x.d.ts" */
const resolveDeclaration = (fromDir, specifier) => {
  const base = resolve(fromDir, specifier.replace(/\.(?:[cm]?[jt]s)$/, ""));
  return [`${base}.d.ts`, join(base, "index.d.ts")].find(existsSync) ?? null;
};

/** Every `types` target in package.json, keyed by public import path. */
const typeEntries = (name, pkg) => {
  const fromExports = Object.entries(pkg.exports ?? {}).flatMap(
    ([subpath, target]) => {
      const types = typeof target === "string" ? null : target.types;
      return types == null
        ? []
        : [[subpath === "." ? name : `${name}/${subpath.slice(2)}`, types]];
    }
  );
  const rootTypes = pkg.types ?? pkg.typings;
  return fromExports.length > 0 || rootTypes == null
    ? fromExports
    : [[name, rootTypes]];
};

const relativeSpecifiers = source =>
  [...source.matchAll(/\bfrom\s+["'](\.[^"']*)["']/g)].map(match => match[1]);

/** Depth-first crawl, so files appear next to the barrel that exports them. */
const crawl = entryFiles => {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    const dir = dirname(file);
    for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
      const next = resolveDeclaration(dir, specifier);
      if (next != null) visit(next);
    }
  };
  entryFiles.forEach(visit);
  return [...seen];
};

const tidy = source =>
  source
    .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
    .replace(/^export \{\};?$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const render = name => {
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
    `# ${name}@${pkg.version}`,
    "",
    "Generated from the installed type declarations by `scripts/lib-docs.mjs`. Do not edit.",
    "",
    `Import paths: ${entries.map(([path]) => `\`${path}\``).join(", ")}`,
    readme != null ? `\nUsage prose: \`node_modules/${name}/${readme}\`` : "",
    "",
    ...files.flatMap(file => [file, ""]),
  ].join("\n");
};

const main = () => {
  const allowlist = readJson(join(root, "package.json")).claudeLibDocs;
  rmSync(outDir, { recursive: true, force: true });
  if (!Array.isArray(allowlist) || allowlist.length === 0) return;

  mkdirSync(outDir, { recursive: true });
  for (const name of allowlist) {
    try {
      writeFileSync(
        join(outDir, `${name.replaceAll("/", "__")}.md`),
        render(name)
      );
    } catch (error) {
      console.warn(`lib-docs: skipped ${name}: ${error.message}`);
    }
  }
};

try {
  main();
} catch (error) {
  console.warn(`lib-docs: failed: ${error.message}`);
}
