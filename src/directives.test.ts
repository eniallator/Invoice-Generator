import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  DIRECTIVES,
  isDirectiveName,
  type DirectiveInput,
} from "./directives.ts";
import { contextFrom, createFiles, lines } from "./test-helpers.ts";

const ITEMS_CFG = lines(
  "[META]",
  "yes=1",
  "no=",
  "[ITEM_1]",
  "hrs=5",
  "rate=6",
  "[ITEM_2]",
  "hrs=2",
  "rate=3"
);

const setup = (
  args: string | undefined,
  overrides: Partial<DirectiveInput> = {}
) => {
  const parse = vi.fn<DirectiveInput["parse"]>(
    (contents, path) => `<${contents}@${path}>`
  );
  const input: DirectiveInput = {
    args,
    contents: "body",
    basePath: "/base/path",
    contextVariables: contextFrom(ITEMS_CFG),
    extra: new Map(),
    parse,
    ...overrides,
  };
  return { input, parse };
};

/** A self closing directive, whose contents come from files in a temp dir */
const setupWithFiles = (
  args: string | undefined,
  files: Record<string, string>
) => {
  const dir = createFiles(files);
  return {
    ...setup(args, { contents: undefined, basePath: dir }),
    dir: realpathSync(dir),
  };
};

const FILES = {
  "flag.tex": "flag",
  "my flag.tex": "spaced flag",
  "sub/nested.tex": "nested",
};

describe("DIRECTIVES", () => {
  it("has the add, map, when and unless directives", () => {
    expect(Object.keys(DIRECTIVES).sort()).toEqual([
      "add",
      "map",
      "unless",
      "when",
    ]);
  });
});

describe("isDirectiveName", () => {
  it.each(["add", "map", "when", "unless"])("accepts %s", name => {
    expect(isDirectiveName(name)).toBe(true);
  });

  it.each([
    "",
    "nope",
    "Map",
    "ADD",
    "toString",
    "constructor",
    "hasOwnProperty",
    "__proto__",
  ])("rejects %j", name => {
    expect(isDirectiveName(name)).toBe(false);
  });
});

describe("when", () => {
  it("parses the contents if the variable has a value", () => {
    const { input, parse } = setup("yes");
    expect(DIRECTIVES.when(input)).toBe("<body@/base/path>");
    expect(parse).toHaveBeenCalledExactlyOnceWith(
      "body",
      "/base/path",
      input.extra
    );
  });

  it.each(["no", "missing", "MISSING.section"])(
    "is empty if the variable (%s) is empty or missing",
    args => {
      const { input, parse } = setup(args);
      expect(DIRECTIVES.when(input)).toBe("");
      expect(parse).not.toHaveBeenCalled();
    }
  );

  it("checks the extra context first", () => {
    const { input } = setup("ITEM.id", {
      extra: new Map([["ITEM", new Map([["id", "1"]])]]),
    });
    expect(DIRECTIVES.when(input)).toBe("<body@/base/path>");
  });

  it("passes the extra context on", () => {
    const extra = new Map([["ITEM", new Map([["id", "1"]])]]);
    const { input, parse } = setup("yes", { extra });
    DIRECTIVES.when(input);
    expect(parse.mock.calls[0]?.[2]).toBe(extra);
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.when(setup(undefined).input)).toThrow(
      "when directive has a single argument for the context variable to check"
    );
  });

  describe("with a contents file", () => {
    it("takes the first argument as the file and the rest as the variable", () => {
      const { input, parse, dir } = setupWithFiles("./flag.tex yes", FILES);
      expect(DIRECTIVES.when(input)).toBe(`<flag@${dir}>`);
      expect(parse).toHaveBeenCalledExactlyOnceWith("flag", dir, input.extra);
    });

    it("does not parse the file if the variable is empty", () => {
      const { input, parse } = setupWithFiles("./flag.tex no", FILES);
      expect(DIRECTIVES.when(input)).toBe("");
      expect(parse).not.toHaveBeenCalled();
    });

    it.each([`"./my flag.tex" yes`, `'./my flag.tex' yes`])(
      "supports quoted paths (%s)",
      args => {
        const { input, dir } = setupWithFiles(args, FILES);
        expect(DIRECTIVES.when(input)).toBe(`<spaced flag@${dir}>`);
      }
    );

    it("parses nested files relative to their own directory", () => {
      const { input, dir } = setupWithFiles("./sub/nested.tex yes", FILES);
      expect(DIRECTIVES.when(input)).toBe(`<nested@${join(dir, "sub")}>`);
    });

    it("trims the rest of the arguments", () => {
      const { input } = setupWithFiles("./flag.tex  \n  yes  ", FILES);
      expect(DIRECTIVES.when(input)).toContain("<flag@");
    });

    it("throws if the file does not exist", () => {
      expect(() =>
        DIRECTIVES.when(setupWithFiles("./nope.tex yes", FILES).input)
      ).toThrow(/Could not find the contents file for when: .*nope\.tex/);
    });

    it("throws if there is neither contents nor a file", () => {
      expect(() =>
        DIRECTIVES.when(setupWithFiles(undefined, FILES).input)
      ).toThrow(
        "when directive needs contents between its tags or the path of a contents file"
      );
    });

    it("still requires the variable", () => {
      expect(() =>
        DIRECTIVES.when(setupWithFiles("./flag.tex", FILES).input)
      ).toThrow("when directive has a single argument");
    });
  });
});

describe("unless", () => {
  it.each(["no", "missing"])(
    "parses the contents if the variable (%s) is empty or missing",
    args => {
      const { input, parse } = setup(args);
      expect(DIRECTIVES.unless(input)).toBe("<body@/base/path>");
      expect(parse).toHaveBeenCalledExactlyOnceWith(
        "body",
        "/base/path",
        input.extra
      );
    }
  );

  it("is empty if the variable has a value", () => {
    const { input, parse } = setup("yes");
    expect(DIRECTIVES.unless(input)).toBe("");
    expect(parse).not.toHaveBeenCalled();
  });

  it("checks the extra context first", () => {
    const { input } = setup("ITEM.id", {
      extra: new Map([["ITEM", new Map([["id", "1"]])]]),
    });
    expect(DIRECTIVES.unless(input)).toBe("");
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.unless(setup(undefined).input)).toThrow(
      "unless directive has a single argument for the context variable to check"
    );
  });

  describe("with a contents file", () => {
    it("parses the file if the variable is empty", () => {
      const { input, dir } = setupWithFiles("./flag.tex no", FILES);
      expect(DIRECTIVES.unless(input)).toBe(`<flag@${dir}>`);
    });

    it("is empty if the variable has a value", () => {
      const { input, parse } = setupWithFiles("./flag.tex yes", FILES);
      expect(DIRECTIVES.unless(input)).toBe("");
      expect(parse).not.toHaveBeenCalled();
    });
  });
});

describe("add", () => {
  const run = (
    args: string | undefined,
    contents?: string,
    extra?: DirectiveInput["extra"]
  ) => {
    const { input, parse } = setup(args, {
      contents,
      ...(extra === undefined ? {} : { extra }),
    });
    return { result: DIRECTIVES.add(input), parse };
  };

  it("adds up the arguments to two decimal places", () => {
    expect(run("ITEM_total_due yes").result).toBe("37.00");
    expect(run("yes yes yes").result).toBe("3.00");
  });

  it("adds up the contents along with the arguments", () => {
    expect(run("ITEM_total_due", "yes").result).toBe("37.00");
    expect(run("yes", "yes yes").result).toBe("3.00");
  });

  it("takes the variables from the contents alone", () => {
    expect(run(undefined, "ITEM_total_due yes").result).toBe("37.00");
  });

  it("separates variables with any whitespace", () => {
    expect(run("ITEM_total_due", "\n  yes\t yes \n").result).toBe("38.00");
    expect(run("yes \n yes").result).toBe("2.00");
  });

  it("counts empty and missing variables as zero", () => {
    expect(run("ITEM_total_due no missing").result).toBe("36.00");
    expect(run("no", "missing").result).toBe("0.00");
  });

  it("reads from the extra context first", () => {
    const extra = new Map([["ITEM", new Map([["subtotal", "4.50"]])]]);
    expect(run("ITEM.subtotal", "yes", extra).result).toBe("5.50");
  });

  it("does not parse anything", () => {
    expect(run("yes yes").parse).not.toHaveBeenCalled();
    expect(run("yes", "yes").parse).not.toHaveBeenCalled();
  });

  it("needs at least two variables in total", () => {
    const message =
      "add directive needs at least two context variables to add up";
    expect(() => run(undefined)).toThrow(message);
    expect(() => run("yes")).toThrow(message);
    expect(() => run("yes", "")).toThrow(message);
    expect(() => run(undefined, " \n\t ")).toThrow(message);
  });

  it("rejects values that are not numbers", () => {
    const extra = new Map([["X", new Map([["v", "abc"]])]]);
    expect(() => run("X.v", "yes", extra)).toThrow(
      "could not convert string to float: 'abc'"
    );
  });
});

describe("map", () => {
  it("parses the contents once per item with the item as context", () => {
    const { input, parse } = setup("ITEM");
    expect(DIRECTIVES.map(input)).toBe("<body@/base/path><body@/base/path>");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(
      parse.mock.calls.map(([, , extra]) => extra.get("ITEM")?.get("id"))
    ).toEqual(["1", "2"]);
  });

  it("is empty when there are no items", () => {
    const { input, parse } = setup("NOTHING");
    expect(DIRECTIVES.map(input)).toBe("");
    expect(parse).not.toHaveBeenCalled();
  });

  it("keeps the outer extra context and adds the item to it", () => {
    const outer = new Map([["OUTER", new Map([["x", "1"]])]]);
    const { input, parse } = setup("ITEM", { extra: outer });
    DIRECTIVES.map(input);
    expect(parse.mock.calls.map(([, , extra]) => [...extra.keys()])).toEqual([
      ["OUTER", "ITEM"],
      ["OUTER", "ITEM"],
    ]);
    expect(outer.has("ITEM")).toBe(false);
  });

  it("lets the item shadow an outer item with the same name", () => {
    const { input, parse } = setup("ITEM", {
      extra: new Map([["ITEM", new Map([["id", "outer"]])]]),
    });
    DIRECTIVES.map(input);
    expect(
      parse.mock.calls.map(([, , extra]) => extra.get("ITEM")?.get("id"))
    ).toEqual(["1", "2"]);
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.map(setup(undefined).input)).toThrow(
      "map directive has a single argument for the context variable to check"
    );
  });

  describe("with a contents file", () => {
    it("takes the first argument as the file and the rest as the prefix", () => {
      const { input, parse, dir } = setupWithFiles("./flag.tex ITEM", FILES);
      expect(DIRECTIVES.map(input)).toBe(`<flag@${dir}><flag@${dir}>`);
      expect(parse).toHaveBeenCalledTimes(2);
      expect(
        parse.mock.calls.map(([, , extra]) => extra.get("ITEM")?.get("id"))
      ).toEqual(["1", "2"]);
    });

    it("keeps the outer extra context", () => {
      const { input, parse } = setupWithFiles("./flag.tex ITEM", FILES);
      const outer = new Map([["OUTER", new Map<string, string>()]]);
      DIRECTIVES.map({ ...input, extra: outer });
      expect([...(parse.mock.calls[0]?.[2].keys() ?? [])]).toEqual([
        "OUTER",
        "ITEM",
      ]);
    });

    it("still requires the prefix", () => {
      expect(() =>
        DIRECTIVES.map(setupWithFiles("./flag.tex", FILES).input)
      ).toThrow("map directive has a single argument");
    });

    it("throws if the file does not exist", () => {
      expect(() =>
        DIRECTIVES.map(setupWithFiles("./nope.tex ITEM", FILES).input)
      ).toThrow(/Could not find the contents file for map/);
    });
  });
});
