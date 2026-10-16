import { describe, expect, it, vi } from "vitest";

import {
  DIRECTIVES,
  isDirectiveName,
  type DirectiveInput,
} from "./directives.ts";
import { contextFrom, lines } from "./test-helpers.ts";

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
  extra: DirectiveInput["extra"] = new Map()
) => {
  const parse = vi.fn<DirectiveInput["parse"]>(
    (contents, path) => `<${contents}@${path}>`
  );
  const input: DirectiveInput = {
    args,
    contents: "body",
    contentsPath: "/contents/path",
    contextVariables: contextFrom(ITEMS_CFG),
    extra,
    parse,
  };
  return { input, parse };
};

describe("DIRECTIVES", () => {
  it("has the map, when and unless directives", () => {
    expect(Object.keys(DIRECTIVES).sort()).toEqual(["map", "unless", "when"]);
  });
});

describe("isDirectiveName", () => {
  it.each(["map", "when", "unless"])("accepts %s", name => {
    expect(isDirectiveName(name)).toBe(true);
  });

  it.each([
    "",
    "nope",
    "Map",
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
    expect(DIRECTIVES.when(input)).toBe("<body@/contents/path>");
    expect(parse).toHaveBeenCalledExactlyOnceWith(
      "body",
      "/contents/path",
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
    const { input } = setup(
      "ITEM.id",
      new Map([["ITEM", new Map([["id", "1"]])]])
    );
    expect(DIRECTIVES.when(input)).toBe("<body@/contents/path>");
  });

  it("passes the extra context on", () => {
    const extra = new Map([["ITEM", new Map([["id", "1"]])]]);
    const { input, parse } = setup("yes", extra);
    DIRECTIVES.when(input);
    expect(parse.mock.calls[0]?.[2]).toBe(extra);
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.when(setup(undefined).input)).toThrow(
      "when directive has a single argument for the context variable to check"
    );
  });
});

describe("unless", () => {
  it.each(["no", "missing"])(
    "parses the contents if the variable (%s) is empty or missing",
    args => {
      const { input, parse } = setup(args);
      expect(DIRECTIVES.unless(input)).toBe("<body@/contents/path>");
      expect(parse).toHaveBeenCalledExactlyOnceWith(
        "body",
        "/contents/path",
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
    const { input } = setup(
      "ITEM.id",
      new Map([["ITEM", new Map([["id", "1"]])]])
    );
    expect(DIRECTIVES.unless(input)).toBe("");
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.unless(setup(undefined).input)).toThrow(
      "unless directive has a single argument for the context variable to check"
    );
  });
});

describe("map", () => {
  it("parses the contents once per item with the item as context", () => {
    const { input, parse } = setup("ITEM");
    expect(DIRECTIVES.map(input)).toBe(
      "<body@/contents/path><body@/contents/path>"
    );
    expect(parse).toHaveBeenCalledTimes(2);
    const contexts = parse.mock.calls.map(([, , extra]) => [...extra.keys()]);
    expect(contexts).toEqual([["ITEM"], ["ITEM"]]);
    expect(
      parse.mock.calls.map(([, , extra]) => extra.get("ITEM")?.get("id"))
    ).toEqual(["1", "2"]);
  });

  it("is empty when there are no items", () => {
    const { input, parse } = setup("NOTHING");
    expect(DIRECTIVES.map(input)).toBe("");
    expect(parse).not.toHaveBeenCalled();
  });

  it("does not pass the outer extra context on", () => {
    const { input, parse } = setup("ITEM", new Map([["OUTER", new Map()]]));
    DIRECTIVES.map(input);
    expect(parse.mock.calls[0]?.[2].has("OUTER")).toBe(false);
  });

  it("requires an argument", () => {
    expect(() => DIRECTIVES.map(setup(undefined).input)).toThrow(
      "map directive has a single argument for the context variable to check"
    );
  });
});
