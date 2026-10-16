import { join } from "node:path";
import { raise } from "niall-utils";
import { describe, expect, it } from "vitest";

import { createFiles, lines } from "../test-helpers.ts";
import { Config, DEFAULT_SECTION } from "./config.ts";

const readConfig = (text: string): Config =>
  Config.read(join(createFiles({ "c.cfg": text }), "c.cfg")) ??
  raise(new Error("config could not be read"));

describe("Config.read", () => {
  it("returns undefined for files that do not exist", () => {
    expect(Config.read(join(createFiles({}), "missing.cfg"))).toBeUndefined();
  });

  it("returns undefined for paths that are not files", () => {
    expect(Config.read(createFiles({ "dir/a.cfg": "" }))).toBeUndefined();
  });

  it("reads an empty file as an empty config", () => {
    expect(readConfig("").sectionNames()).toEqual([DEFAULT_SECTION]);
  });

  it("reads sections and options", () => {
    const config = readConfig(
      lines("[A]", "one=1", "two = 2", "", "[B]", "x=y")
    );
    expect(config.sectionNames()).toEqual([DEFAULT_SECTION, "A", "B"]);
    expect(config.get("A", "one")).toBe("1");
    expect(config.get("A", "two")).toBe("2");
    expect(config.get("B", "x")).toBe("y");
  });

  it("accepts both = and : as delimiters, splitting on the first one", () => {
    const config = readConfig(
      lines("[A]", "eq=a:b", "colon: c=d", "spaced   =   e  ")
    );
    expect(config.get("A", "eq")).toBe("a:b");
    expect(config.get("A", "colon")).toBe("c=d");
    expect(config.get("A", "spaced")).toBe("e");
  });

  it("lower-cases option names but not values or section names", () => {
    const config = readConfig(lines("[Sec]", "MiXed=VaLuE"));
    expect(config.get("Sec", "mixed")).toBe("VaLuE");
    expect(config.get("Sec", "MIXED")).toBe("VaLuE");
    expect(config.get("sec", "mixed")).toBeUndefined();
  });

  it("allows empty values", () => {
    const config = readConfig(lines("[A]", "empty=", "other=x"));
    expect(config.get("A", "empty")).toBe("");
    expect(config.hasOption("A", "empty")).toBe(true);
  });

  it("ignores full line comments starting with # or ;", () => {
    const config = readConfig(
      lines("# leading", "[A]", "; mid", "k=v", "  # indented", "other=1")
    );
    expect(config.options("A")).toEqual(["k", "other"]);
    expect(config.get("A", "k")).toBe("v");
  });

  it("does not treat inline # or ; as comments", () => {
    const config = readConfig(lines("[A]", "k=v # not a comment ; either"));
    expect(config.get("A", "k")).toBe("v # not a comment ; either");
  });

  it("joins indented continuation lines with newlines", () => {
    const config = readConfig(
      lines("[A]", "multi=first", "  second", "\tthird", "next=1")
    );
    expect(config.get("A", "multi")).toBe("first\nsecond\nthird");
    expect(config.get("A", "next")).toBe("1");
  });

  it("supports a value that starts on its continuation lines", () => {
    const config = readConfig(lines("[A]", "list=", "  a", "  b"));
    expect(config.get("A", "list")).toBe("\na\nb");
  });

  it("keeps blank lines inside values but trims trailing ones", () => {
    const config = readConfig(
      lines("[A]", "multi=first", "", "  second", "", "", "[B]", "k=v")
    );
    expect(config.get("A", "multi")).toBe("first\n\nsecond");
  });

  it("does not add comment lines to a value", () => {
    const config = readConfig(
      lines("[A]", "multi=first", "# note", "  second")
    );
    expect(config.get("A", "multi")).toBe("first\nsecond");
  });

  it("only treats lines indented deeper than the option as continuations", () => {
    const config = readConfig(lines("  [A]", "  k=v", "  j=w", "    cont"));
    expect(config.get("A", "k")).toBe("v");
    expect(config.get("A", "j")).toBe("w\ncont");
  });

  it("does not continue a value across a section header", () => {
    const config = readConfig(lines("[A]", "k=v", "[B]", "  stray=1"));
    expect(config.get("A", "k")).toBe("v");
    expect(config.get("B", "stray")).toBe("1");
  });

  it("handles CRLF line endings", () => {
    const config = readConfig("[A]\r\nk=v\r\nmulti=a\r\n  b\r\n");
    expect(config.get("A", "k")).toBe("v");
    expect(config.get("A", "multi")).toBe("a\nb");
  });

  it("handles a blank line before any section", () => {
    expect(readConfig(lines("", "[A]", "k=v")).get("A", "k")).toBe("v");
  });

  it("applies the DEFAULT section to every section", () => {
    const config = readConfig(
      lines("[DEFAULT]", "shared=base", "[A]", "k=1", "[B]", "shared=own")
    );
    expect(config.get("A", "shared")).toBe("base");
    expect(config.get("B", "shared")).toBe("own");
    expect(config.get(DEFAULT_SECTION, "shared")).toBe("base");
    expect(config.items("A")).toEqual(
      new Map([
        ["shared", "base"],
        ["k", "1"],
      ])
    );
  });

  it("allows the DEFAULT section to appear more than once", () => {
    const config = readConfig(
      lines("[DEFAULT]", "a=1", "[A]", "k=v", "[DEFAULT]", "b=2")
    );
    expect(config.options(DEFAULT_SECTION)).toEqual(["a", "b"]);
  });

  it("rejects duplicate sections", () => {
    expect(() => readConfig(lines("[A]", "k=1", "[A]", "j=2"))).toThrow(
      /line 3: duplicate section 'A'/
    );
  });

  it("rejects duplicate options within a section", () => {
    expect(() => readConfig(lines("[A]", "k=1", "K=2"))).toThrow(
      /line 3: duplicate option 'k' in 'A'/
    );
  });

  it("allows the same option in different sections", () => {
    const config = readConfig(lines("[A]", "k=1", "[B]", "k=2"));
    expect(config.get("A", "k")).toBe("1");
    expect(config.get("B", "k")).toBe("2");
  });

  it("rejects options before any section header", () => {
    expect(() => readConfig("k=v")).toThrow(
      /line 1: file contains no section headers/
    );
  });

  it("rejects lines that are not options", () => {
    expect(() => readConfig(lines("[A]", "just text"))).toThrow(
      /line 2: could not parse 'just text'/
    );
  });

  it("rejects options with no name", () => {
    expect(() => readConfig(lines("[A]", "=value"))).toThrow(
      /line 2: could not parse '=value'/
    );
  });
});

describe("Config", () => {
  describe("sections", () => {
    it("distinguishes real sections from the default section", () => {
      const config = readConfig("[A]\nk=v");
      expect(config.hasSection("A")).toBe(true);
      expect(config.hasSection(DEFAULT_SECTION)).toBe(false);
      expect(config.hasSection("missing")).toBe(false);
      expect(config.contains("A")).toBe(true);
      expect(config.contains(DEFAULT_SECTION)).toBe(true);
      expect(config.contains("missing")).toBe(false);
    });

    it("adds sections", () => {
      const config = new Config();
      config.addSection("A");
      expect(config.sectionNames()).toEqual([DEFAULT_SECTION, "A"]);
      expect(config.options("A")).toEqual([]);
    });

    it("refuses to add the default section or an existing section twice", () => {
      const config = new Config();
      config.addSection("A");
      expect(() => {
        config.addSection("A");
      }).toThrow("Section 'A' already exists");
      expect(() => {
        config.addSection(DEFAULT_SECTION);
      }).toThrow("Section 'DEFAULT' already exists");
    });
  });

  describe("get / set", () => {
    it("returns undefined for missing sections and options", () => {
      const config = readConfig("[A]\nk=v");
      expect(config.get("missing", "k")).toBeUndefined();
      expect(config.get("A", "missing")).toBeUndefined();
      expect(config.hasOption("A", "missing")).toBe(false);
    });

    it("does not apply defaults to sections that do not exist", () => {
      const config = readConfig("[DEFAULT]\nk=v");
      expect(config.get("missing", "k")).toBeUndefined();
      expect(config.get(DEFAULT_SECTION, "k")).toBe("v");
    });

    it("sets values, lower-casing the option name", () => {
      const config = readConfig("[A]\nk=v");
      config.set("A", "K", "new");
      config.set("A", "Added", "x");
      expect(config.get("A", "k")).toBe("new");
      expect(config.get("A", "added")).toBe("x");
    });

    it("can set the default section", () => {
      const config = readConfig("[A]\nk=v");
      config.set(DEFAULT_SECTION, "d", "1");
      expect(config.get("A", "d")).toBe("1");
    });

    it("throws when setting on a missing section", () => {
      expect(() => {
        new Config().set("missing", "k", "v");
      }).toThrow("No section: 'missing'");
    });
  });

  describe("items / options", () => {
    it("lists a section's options with defaults, the section winning", () => {
      const config = readConfig(
        lines("[DEFAULT]", "a=default", "b=default", "[S]", "b=own", "c=own")
      );
      expect(config.items("S")).toEqual(
        new Map([
          ["a", "default"],
          ["b", "own"],
          ["c", "own"],
        ])
      );
      expect(config.options("S")).toEqual(["a", "b", "c"]);
    });

    it("returns a copy", () => {
      const config = readConfig("[S]\nk=v");
      config.items("S").set("k", "changed");
      expect(config.get("S", "k")).toBe("v");
    });

    it("throws for missing sections", () => {
      expect(() => new Config().items("missing")).toThrow(
        "No section: 'missing'"
      );
    });
  });

  describe("getFloat", () => {
    it("parses stored values", () => {
      expect(readConfig("[A]\nk=2.5").getFloat("A", "k", 0)).toBe(2.5);
    });

    it("uses the fallback for missing values", () => {
      expect(readConfig("[A]\nk=2.5").getFloat("A", "other", 7)).toBe(7);
      expect(new Config().getFloat("missing", "k", 3)).toBe(3);
    });

    it("throws for values that are not floats", () => {
      expect(() => readConfig("[A]\nk=abc").getFloat("A", "k", 0)).toThrow(
        "could not convert string to float: 'abc'"
      );
    });
  });

  describe("merge", () => {
    it("copies options over, creating missing sections", () => {
      const target = readConfig(lines("[A]", "keep=1", "over=old"));
      target.merge(readConfig(lines("[A]", "over=new", "[B]", "added=2")));
      expect(target.get("A", "keep")).toBe("1");
      expect(target.get("A", "over")).toBe("new");
      expect(target.get("B", "added")).toBe("2");
    });

    it("merges the default section", () => {
      const target = readConfig("[A]\nk=v");
      target.merge(readConfig("[DEFAULT]\nd=1"));
      expect(target.get(DEFAULT_SECTION, "d")).toBe("1");
      expect(target.get("A", "d")).toBe("1");
    });

    // Regression: Python's ConfigParser.items(section) includes the defaults,
    // so merging copies inherited defaults into each section as own options.
    it("copies inherited defaults into every merged section", () => {
      const target = new Config();
      target.merge(readConfig(lines("[DEFAULT]", "d=1", "[A]", "k=v")));
      target.set(DEFAULT_SECTION, "d", "changed");
      expect(target.get("A", "d")).toBe("1");
    });
  });
});
