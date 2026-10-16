import { readFileSync, realpathSync } from "node:fs";
import { EOL } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { isFile, parseItemPath, readText, realpath, writeText } from "./io.ts";
import { createFiles } from "./test-helpers.ts";

describe("readText", () => {
  it("normalises CRLF and lone CR newlines to LF", () => {
    const dir = createFiles({ "a.txt": "one\r\ntwo\rthree\nfour" });
    expect(readText(join(dir, "a.txt"))).toBe("one\ntwo\nthree\nfour");
  });

  it("strips a leading UTF-8 byte order mark", () => {
    const dir = createFiles({ "a.txt": "﻿hello" });
    expect(readText(join(dir, "a.txt"))).toBe("hello");
  });

  it("only strips the byte order mark at the start", () => {
    const dir = createFiles({ "a.txt": "a﻿b" });
    expect(readText(join(dir, "a.txt"))).toBe("a﻿b");
  });

  it("throws for files that do not exist", () => {
    const dir = createFiles({});
    expect(() => readText(join(dir, "missing.txt"))).toThrow();
  });
});

describe("writeText", () => {
  it("writes newlines as the platform's line ending", () => {
    const dir = createFiles({});
    const target = join(dir, "out.txt");
    writeText(target, "a\nb\n");
    expect(readFileSync(target, "utf8")).toBe(`a${EOL}b${EOL}`);
  });
});

describe("isFile", () => {
  it("is true for files", () => {
    const dir = createFiles({ "a.txt": "" });
    expect(isFile(join(dir, "a.txt"))).toBe(true);
  });

  it("is false for directories and missing paths", () => {
    const dir = createFiles({ "sub/a.txt": "" });
    expect(isFile(join(dir, "sub"))).toBe(false);
    expect(isFile(join(dir, "missing"))).toBe(false);
  });
});

describe("realpath", () => {
  it("resolves existing paths", () => {
    const dir = createFiles({ "a.txt": "" });
    expect(realpath(join(dir, "a.txt"))).toBe(realpathSync(join(dir, "a.txt")));
  });

  it("falls back to the absolute path for missing paths", () => {
    expect(realpath("does/not/exist.cfg")).toBe(resolve("does/not/exist.cfg"));
  });
});

describe("parseItemPath", () => {
  let dir = "";
  beforeEach(() => {
    dir = createFiles({ "sub/item.tex": "", "other.tex": "" });
  });

  it("resolves dot-prefixed paths against the base path", () => {
    expect(parseItemPath("./sub/item.tex", dir)).toBe(
      realpathSync(join(dir, "sub", "item.tex"))
    );
    expect(parseItemPath("../other.tex", join(dir, "sub"))).toBe(
      realpathSync(join(dir, "other.tex"))
    );
  });

  it("resolves other paths against the current working directory", () => {
    expect(parseItemPath("some/where.tex", dir)).toBe(
      resolve("some/where.tex")
    );
  });

  it("keeps absolute paths as they are", () => {
    const absolute = join(dir, "other.tex");
    expect(parseItemPath(absolute, "/ignored")).toBe(absolute);
  });

  it.each(['"./other.tex"', "'./other.tex'"])(
    "strips matching surrounding quotes from %s",
    quoted => {
      expect(parseItemPath(quoted, dir)).toBe(
        realpathSync(join(dir, "other.tex"))
      );
    }
  );

  it("keeps mismatched quotes", () => {
    expect(parseItemPath(`"abc'`, dir)).toBe(resolve(`"abc'`));
    expect(parseItemPath(`"abc`, dir)).toBe(resolve(`"abc`));
  });

  it("handles a lone quote character", () => {
    expect(parseItemPath(`"`, dir)).toBe(resolve(""));
  });

  it("handles the empty path", () => {
    expect(parseItemPath("", dir)).toBe(resolve(""));
  });
});
