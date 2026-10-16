import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createFiles, lines } from "../test-helpers.ts";
import { loadConfig, META } from "./imports.ts";

const load = (files: Record<string, string>, entry = "main.cfg") =>
  loadConfig(join(createFiles(files), entry));

describe("loadConfig", () => {
  it("always has a META section", () => {
    const config = load({ "main.cfg": "[OTHER]\nk=v" });
    expect(config.hasSection(META)).toBe(true);
    expect(config.get("OTHER", "k")).toBe("v");
  });

  it("loads an empty entry point", () => {
    expect(load({ "main.cfg": "" }).hasSection(META)).toBe(true);
  });

  // Regression: the entry point is merged last, so its own import option is
  // what remains, while imported files' import options are cleared
  it("ends up with the entry point's own import option", () => {
    const config = load({
      "main.cfg": lines("[META]", "import=./a"),
      "a.cfg": lines("[META]", "import=./b", "x=1"),
      "b.cfg": "[META]\ny=2",
    });
    expect(config.get(META, "import")).toBe("./a");
    expect(config.get(META, "y")).toBe("2");
  });

  it("clears the import option when the entry point has none", () => {
    const config = load({
      "main.cfg": lines("[OTHER]", "k=v"),
    });
    expect(config.get(META, "import")).toBe("");
  });

  describe("import paths", () => {
    it("adds the .cfg extension implicitly", () => {
      const config = load({
        "main.cfg": "[META]\nimport=./lib",
        "lib.cfg": "[META]\nx=1",
      });
      expect(config.get(META, "x")).toBe("1");
    });

    it("resolves relative imports against the importing file", () => {
      const config = load(
        {
          "raw/main.cfg": "[META]\nimport=../clients/client",
          "clients/client.cfg": "[META]\nimport=./nested/deeper\nfrom=client",
          "clients/nested/deeper.cfg": "[META]\ndeep=yes",
        },
        "raw/main.cfg"
      );
      expect(config.get(META, "from")).toBe("client");
      expect(config.get(META, "deep")).toBe("yes");
    });

    it("resolves non-relative imports against the working directory", () => {
      const dir = createFiles({ "lib/shared.cfg": "[META]\nx=1" });
      const absolute = join(dir, "lib", "shared").replaceAll("\\", "/");
      const config = load({ "main.cfg": `[META]\nimport=${absolute}` });
      expect(config.get(META, "x")).toBe("1");
    });

    it("splits multiple imports on newlines", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=./a", "  ./b", "  ./sub/c"),
        "a.cfg": "[META]\na=1",
        "b.cfg": "[META]\nb=2",
        "sub/c.cfg": "[META]\nc=3",
      });
      expect(config.get(META, "a")).toBe("1");
      expect(config.get(META, "b")).toBe("2");
      expect(config.get(META, "c")).toBe("3");
    });

    it("ignores blank import lines", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=", "  ./a", "", "[OTHER]", "k=v"),
        "a.cfg": "[META]\na=1",
      });
      expect(config.get(META, "a")).toBe("1");
    });
  });

  describe("precedence", () => {
    it("lets the entry point override everything it imports", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=./a", "x=entry"),
        "a.cfg": "[META]\nx=a\ny=a",
      });
      expect(config.get(META, "x")).toBe("entry");
      expect(config.get(META, "y")).toBe("a");
    });

    it("lets later imports override earlier ones", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=./a", "  ./b"),
        "a.cfg": "[META]\nx=a\nonly_a=1",
        "b.cfg": "[META]\nx=b",
      });
      expect(config.get(META, "x")).toBe("b");
      expect(config.get(META, "only_a")).toBe("1");
    });

    // Regression: imports are processed depth first, so a file's own imports
    // are applied before its later siblings
    it("applies an import's imports before the next sibling import", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=./a", "  ./b"),
        "a.cfg": lines("[META]", "import=./c", "x=a", "y=a"),
        "c.cfg": "[META]\nx=c\ny=c\nz=c",
        "b.cfg": "[META]\ny=b",
      });
      // processing order is: a, c, b, then main
      expect(config.get(META, "x")).toBe("c");
      expect(config.get(META, "y")).toBe("b");
      expect(config.get(META, "z")).toBe("c");
    });

    it("merges sections across files", () => {
      const config = load({
        "main.cfg": lines("[META]", "import=./a", "[S]", "own=1"),
        "a.cfg": "[S]\nfrom_a=2\nown=overridden",
      });
      expect(config.get("S", "own")).toBe("1");
      expect(config.get("S", "from_a")).toBe("2");
    });
  });

  describe("errors", () => {
    it("throws if the entry point cannot be read", () => {
      expect(() => load({}, "missing.cfg")).toThrow(
        /Could not import the following config files:\n.*missing\.cfg/
      );
    });

    it("lists every import that could not be read", () => {
      expect(() =>
        load({ "main.cfg": lines("[META]", "import=./one", "  ./two") })
      ).toThrow(/one\.cfg\n.*two\.cfg/);
    });

    it("still reads imports that exist when others are missing", () => {
      expect(() =>
        load({
          "main.cfg": lines("[META]", "import=./missing", "  ./present"),
          "present.cfg": "[META]\nx=1",
        })
      ).toThrow(/missing\.cfg/);
    });
  });
});
