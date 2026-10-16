import { describe, expect, it } from "vitest";

import { lines, render } from "./test-helpers.ts";

const ITEMS_CFG = lines(
  "[META]",
  "yes=1",
  "no=",
  "[ITEM_1]",
  "description=First",
  "hrs=5",
  "rate=6",
  "recurring=40",
  "[ITEM_2]",
  "description=Second",
  "hrs=2",
  "rate=3"
);

describe("DynamicContentParser", () => {
  describe("context variables", () => {
    const cfg = lines(
      "[META]",
      "a=1",
      "b=2",
      "[PAYMENT]",
      "currency=\\pounds",
      "account_name=John Doe"
    );

    it("returns text without variables untouched", () => {
      expect(render("plain { text } {{ }} {{}}")).toBe(
        "plain { text } {{ }} {{}}"
      );
      expect(render("")).toBe("");
    });

    it("inserts META variables by bare name", () => {
      expect(render("a={{ a }}", cfg)).toBe("a=1");
    });

    it("inserts section variables", () => {
      expect(render("{{ PAYMENT.account_name }}", cfg)).toBe("John Doe");
    });

    it("allows any amount of whitespace inside the braces", () => {
      expect(render("{{a}}|{{ a }}|{{   a   }}|{{\ta\n}}", cfg)).toBe(
        "1|1|1|1"
      );
    });

    it("inserts every variable", () => {
      expect(render("{{ a }}{{ b }}\n{{ a }}", cfg)).toBe("12\n1");
    });

    it("replaces missing variables with an empty string", () => {
      expect(
        render("[{{ nope }}][{{ PAYMENT.nope }}][{{ NOPE.a }}]", cfg)
      ).toBe("[][][]");
    });

    it("rejects variables with too many parts", () => {
      expect(() => render("{{ a.b.c }}", cfg)).toThrow(
        "Invalid variable 'a.b.c'"
      );
    });

    // Regression: LaTeX braces directly next to the variable braces
    it("handles variables surrounded by LaTeX braces", () => {
      expect(render("\\large{{{ PAYMENT.currency }}{{ a }}}", cfg)).toBe(
        "\\large{\\pounds1}"
      );
    });

    // Regression: replacement values must never be treated as replacement patterns
    it("inserts values containing $ patterns literally", () => {
      const result = render(
        "{{ price }}",
        lines("[META]", "price=$& $1 $$ $` $' $<x>")
      );
      expect(result).toBe("$& $1 $$ $` $' $<x>");
    });

    it("does not re-parse variable values", () => {
      expect(render("{{ a }}", lines("[META]", "a={{ b }}", "b=2"))).toBe(
        "{{ b }}"
      );
    });

    it("leaves closing tags and incomplete directives alone", () => {
      expect(render("{/* when *} {* } { * when a * }")).toBe(
        "{/* when *} {* } { * when a * }"
      );
    });
  });

  describe("when / unless", () => {
    it("shows the contents when the variable has a value", () => {
      expect(render("{* when yes *}shown{/* when *}", ITEMS_CFG)).toBe("shown");
    });

    it("hides the contents when the variable is empty or missing", () => {
      expect(render("[{* when no *}hidden{/* when *}]", ITEMS_CFG)).toBe("[]");
      expect(render("[{* when missing *}hidden{/* when *}]", ITEMS_CFG)).toBe(
        "[]"
      );
    });

    it("does the inverse with unless", () => {
      expect(render("[{* unless yes *}hidden{/* unless *}]", ITEMS_CFG)).toBe(
        "[]"
      );
      expect(render("[{* unless no *}shown{/* unless *}]", ITEMS_CFG)).toBe(
        "[shown]"
      );
      expect(
        render("[{* unless missing *}shown{/* unless *}]", ITEMS_CFG)
      ).toBe("[shown]");
    });

    it("tolerates extra whitespace in the tags", () => {
      expect(render("{*   when    yes   *}x{/*   when   *}", ITEMS_CFG)).toBe(
        "x"
      );
    });

    it("parses variables and directives inside the contents", () => {
      expect(
        render(
          "{* when yes *}[{{ yes }}{* unless no *}!{/* unless *}]{/* when *}",
          ITEMS_CFG
        )
      ).toBe("[1!]");
    });

    it("supports multi-line contents", () => {
      expect(
        render("{* when yes *}\nline1\nline2\n{/* when *}", ITEMS_CFG)
      ).toBe("\nline1\nline2\n");
    });

    it("handles several directives in a row", () => {
      expect(
        render(
          "{* when yes *}1{/* when *}{* when no *}2{/* when *}{* when yes *}3{/* when *}",
          ITEMS_CFG
        )
      ).toBe("13");
    });

    it("supports nesting directives of different names", () => {
      expect(
        render(
          "{* when yes *}a{* unless no *}b{/* unless *}c{/* when *}",
          ITEMS_CFG
        )
      ).toBe("abc");
    });

    describe("nesting directives of the same name", () => {
      const template =
        "{* when yes *}1{* when inner *}2{/* when *}3{/* when *}4";

      it("matches closing tags to the right opening tag", () => {
        expect(render(template, lines("[META]", "yes=1", "inner=1"))).toBe(
          "1234"
        );
        expect(render(template, ITEMS_CFG)).toBe("134");
      });

      it("hides everything when the outer directive is false", () => {
        expect(
          render(
            "{* when no *}1{* when yes *}2{/* when *}3{/* when *}4",
            ITEMS_CFG
          )
        ).toBe("4");
      });

      it("handles deeper nesting and siblings", () => {
        expect(
          render(
            "{* when yes *}a{* when yes *}b{* when yes *}c{/* when *}d{/* when *}e{* when no *}f{/* when *}g{/* when *}",
            ITEMS_CFG
          )
        ).toBe("abcdeg");
      });
    });

    it("requires an argument", () => {
      expect(() => render("{* when *} x{/* when *}")).toThrow(
        "when directive has a single argument for the context variable to check"
      );
    });

    it("requires a closing tag", () => {
      expect(() => render("{* when yes *}x", ITEMS_CFG)).toThrow(
        "Could not find the closing directive for when"
      );
    });

    it("requires a closing tag for nested openings too", () => {
      expect(() =>
        render("{* when yes *}{* when yes *}x{/* when *}", ITEMS_CFG)
      ).toThrow("Could not find the closing directive for when");
    });

    it("rejects unknown directives", () => {
      expect(() => render("{* nope x *}y{/* nope *}")).toThrow(
        "Unknown directive: nope"
      );
    });
  });

  describe("map", () => {
    it("repeats the contents for each item", () => {
      expect(
        render(
          "{* map ITEM *}[{{ ITEM.id }}:{{ ITEM.subtotal }}]{/* map *}",
          ITEMS_CFG
        )
      ).toBe("[1:30.00][2:6.00]");
    });

    it("exposes every option of the item", () => {
      expect(
        render(
          "{* map ITEM *}{{ ITEM.description }}/{{ ITEM.hrs }}/{{ ITEM.rate }};{/* map *}",
          ITEMS_CFG
        )
      ).toBe("First/5/6.00;Second/2/3.00;");
    });

    it("is empty when there are no items with the prefix", () => {
      expect(render("[{* map NOTHING *}x{/* map *}]", ITEMS_CFG)).toBe("[]");
    });

    it("keeps the outer config available inside", () => {
      expect(render("{* map ITEM *}{{ yes }}{/* map *}", ITEMS_CFG)).toBe("11");
    });

    it("supports directives inside the contents using the item", () => {
      expect(
        render(
          "{* map ITEM *}{* when ITEM.recurring *}R{/* when *}{* unless ITEM.recurring *}-{/* unless *}{/* map *}",
          ITEMS_CFG
        )
      ).toBe("R-");
    });

    it("does not see the item outside of the map", () => {
      expect(render("{* map ITEM *}{/* map *}[{{ ITEM.id }}]", ITEMS_CFG)).toBe(
        "[]"
      );
    });

    it("maps over the expenses too", () => {
      expect(
        render(
          "{* map EXPENSE *}{{ EXPENSE.id }}={{ EXPENSE.subtotal }};{/* map *}",
          lines("[EXPENSE_a]", "qty=2", "price=1.5")
        )
      ).toBe("a=3.00;");
    });

    it("requires an argument", () => {
      expect(() => render("{* map *} x{/* map *}")).toThrow(
        "map directive has a single argument for the context variable to check"
      );
    });

    // TODO: not implemented yet. Map should iterate every section starting with
    // the given argument and expose all of the precomputed values (e.g. ALL_ITEMS
    // totals) to the contents, and nested maps should keep the outer item.
    it.todo("exposes the precomputed values inside the contents");
    it.todo("keeps the outer item available inside a nested map");
  });

  describe("directives with a contents file", () => {
    const files = {
      "item.tex": "<{{ ITEM.id }}>",
      "my item.tex": "({{ ITEM.id }})",
      "sub/outer.tex": "{* map ./inner.tex ITEM *}|{{ yes }}",
      "sub/inner.tex": "[{{ ITEM.id }}]",
      "flag.tex": "flag",
    };

    it("uses the file as the contents", () => {
      expect(render("{* map ./item.tex ITEM *}", ITEMS_CFG, files)).toBe(
        "<1><2>"
      );
    });

    it("works with other directives", () => {
      expect(render("{* when ./flag.tex yes *}", ITEMS_CFG, files)).toBe(
        "flag"
      );
      expect(render("{* when ./flag.tex no *}", ITEMS_CFG, files)).toBe("");
      expect(render("{* unless ./flag.tex no *}", ITEMS_CFG, files)).toBe(
        "flag"
      );
    });

    it.each(['"./my item.tex"', "'./my item.tex'"])(
      "supports quoted paths (%s)",
      quoted => {
        expect(render(`{* map ${quoted} ITEM *}`, ITEMS_CFG, files)).toBe(
          "(1)(2)"
        );
      }
    );

    it("resolves nested paths relative to the containing file", () => {
      expect(render("{* when ./sub/outer.tex yes *}", ITEMS_CFG, files)).toBe(
        "[1][2]|1"
      );
    });

    it("does not need a closing tag", () => {
      expect(render("a{* map ./item.tex ITEM *}b", ITEMS_CFG, files)).toBe(
        "a<1><2>b"
      );
    });

    it("treats a path that is not a file as the argument and needs a closing tag", () => {
      expect(() =>
        render("{* when ./nope.tex yes *}", ITEMS_CFG, files)
      ).toThrow("Could not find the closing directive for when");
    });

    it("throws for missing arguments", () => {
      expect(() => render("{* map ./item.tex *}", ITEMS_CFG, files)).toThrow(
        "map directive has a single argument"
      );
    });
  });
});
