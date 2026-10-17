import { describe, expect, it } from "vitest";

import { lines, render } from "../test-helpers.ts";

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
  "rate=3",
  "[EXPENSE_a]",
  "qty=2",
  "price=10"
);

describe("DynamicContentParser", () => {
  describe("context variables", () => {
    const cfg = lines(
      "[META]",
      "a=1",
      "b=2",
      "[PAYMENT]",
      "currency=£",
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

    it("inserts group variables", () => {
      expect(
        render(
          "{{ ITEM_total_due }}|{{ ITEM_hrs }}|{{ EXPENSE_total_due }}",
          ITEMS_CFG
        )
      ).toBe("36.00|5, 2|20.00");
    });

    // Regression: braces directly next to the variable braces
    it("handles variables surrounded by braces", () => {
      expect(render("#f{{{ PAYMENT.currency }}{{ a }}}", cfg)).toBe("#f{£1}");
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

    it("leaves ordinary comments and incomplete tags alone", () => {
      const template = "/* a comment */ /*% */ /*%x*/ /*% when a */ /*< x */";
      expect(render(template)).toBe(template);
    });
  });

  describe("block directives", () => {
    it("shows the contents when the variable has a value", () => {
      expect(render("/*% when yes >*/shown/*< when %*/", ITEMS_CFG)).toBe(
        "shown"
      );
    });

    it("hides the contents when the variable is empty or missing", () => {
      expect(render("[/*% when no >*/hidden/*< when %*/]", ITEMS_CFG)).toBe(
        "[]"
      );
      expect(
        render("[/*% when missing >*/hidden/*< when %*/]", ITEMS_CFG)
      ).toBe("[]");
    });

    it("does the inverse with unless", () => {
      expect(
        render("[/*% unless yes >*/hidden/*< unless %*/]", ITEMS_CFG)
      ).toBe("[]");
      expect(render("[/*% unless no >*/shown/*< unless %*/]", ITEMS_CFG)).toBe(
        "[shown]"
      );
      expect(
        render("[/*% unless missing >*/shown/*< unless %*/]", ITEMS_CFG)
      ).toBe("[shown]");
    });

    it("tolerates extra whitespace in the tags", () => {
      expect(
        render("/*%   when    yes   >*/x/*<   when   %*/", ITEMS_CFG)
      ).toBe("x");
    });

    it("tolerates no whitespace around the tags", () => {
      expect(render("/*%when yes>*/x/*<when%*/", ITEMS_CFG)).toBe("x");
    });

    it("tolerates newlines within the tags", () => {
      expect(
        render("/*%\n  when\n  yes\n>*/x/*<\n  when\n%*/", ITEMS_CFG)
      ).toBe("x");
    });

    it("parses variables and directives inside the contents", () => {
      expect(
        render(
          "/*% when yes >*/[{{ yes }}/*% unless no >*/!/*< unless %*/]/*< when %*/",
          ITEMS_CFG
        )
      ).toBe("[1!]");
    });

    it("supports multi-line contents", () => {
      expect(
        render("/*% when yes >*/\nline1\nline2\n/*< when %*/", ITEMS_CFG)
      ).toBe("\nline1\nline2\n");
    });

    it("handles several directives in a row", () => {
      expect(
        render(
          "/*% when yes >*/1/*< when %*//*% when no >*/2/*< when %*//*% when yes >*/3/*< when %*/",
          ITEMS_CFG
        )
      ).toBe("13");
    });

    it("works wherever the tags are in a Typst file, such as in its code", () => {
      expect(
        render(
          "#f(a,/*% when yes >*/ b,/*< when %*//*% when no >*/ c,/*< when %*/ d)",
          ITEMS_CFG
        )
      ).toBe("#f(a, b, d)");
    });

    it("supports nesting directives of different names", () => {
      expect(
        render(
          "/*% when yes >*/a/*% unless no >*/b/*< unless %*/c/*< when %*/",
          ITEMS_CFG
        )
      ).toBe("abc");
    });

    describe("nesting directives of the same name", () => {
      const template =
        "/*% when yes >*/1/*% when inner >*/2/*< when %*/3/*< when %*/4";

      it("matches closing tags to the right opening tag", () => {
        expect(render(template, lines("[META]", "yes=1", "inner=1"))).toBe(
          "1234"
        );
        expect(render(template, ITEMS_CFG)).toBe("134");
      });

      it("hides everything when the outer directive is false", () => {
        expect(
          render(
            "/*% when no >*/1/*% when yes >*/2/*< when %*/3/*< when %*/4",
            ITEMS_CFG
          )
        ).toBe("4");
      });

      it("handles deeper nesting and siblings", () => {
        expect(
          render(
            "/*% when yes >*/a/*% when yes >*/b/*% when yes >*/c/*< when %*/d/*< when %*/e/*% when no >*/f/*< when %*/g/*< when %*/",
            ITEMS_CFG
          )
        ).toBe("abcdeg");
      });
    });

    it("requires an argument", () => {
      expect(() => render("/*% when >*/x/*< when %*/")).toThrow(
        "when directive has a single argument for the context variable to check"
      );
    });

    it("requires a closing tag", () => {
      expect(() => render("/*% when yes >*/x", ITEMS_CFG)).toThrow(
        "Could not find the closing directive for when"
      );
    });

    it("requires a closing tag for nested openings too", () => {
      expect(() =>
        render("/*% when yes >*//*% when yes >*/x/*< when %*/", ITEMS_CFG)
      ).toThrow("Could not find the closing directive for when");
    });

    it("rejects a closing tag that has no opening tag", () => {
      expect(() => render("a/*< when %*/", ITEMS_CFG)).toThrow(
        "Found the closing directive for when, but not its opening"
      );
    });

    it("rejects unknown directives", () => {
      expect(() => render("/*% nope x >*/y/*< nope %*/")).toThrow(
        "Unknown directive: nope"
      );
    });
  });

  describe("self closing directives", () => {
    const files = {
      "item.typ": "<{{ EXPENSE.id }}>",
      "my item.typ": "({{ ITEM.id }})",
      "sub/outer.typ": "/*% map ./inner.typ ITEM %*/|{{ yes }}",
      "sub/inner.typ": "[{{ ITEM.id }}]",
      "flag.typ": "flag",
    };

    it("has no contents of its own, so needs no closing tag", () => {
      expect(render("a/*% add yes yes %*/b", ITEMS_CFG)).toBe("a2.00b");
    });

    it("tolerates any whitespace in the tag", () => {
      expect(render("/*%add yes yes%*/", ITEMS_CFG)).toBe("2.00");
      expect(render("/*%\n  add\n  yes\n  yes\n%*/", ITEMS_CFG)).toBe("2.00");
    });

    it("rejects unknown directives", () => {
      expect(() => render("/*% nope %*/")).toThrow("Unknown directive: nope");
    });

    it("cannot be a directive that needs contents", () => {
      expect(() => render("/*% when %*/")).toThrow(
        "when directive needs contents between its tags or the path of a contents file"
      );
    });

    describe("with a contents file", () => {
      it("uses the file as the contents", () => {
        expect(render("/*% map ./item.typ EXPENSE %*/", ITEMS_CFG, files)).toBe(
          "<a>"
        );
      });

      it("works with other directives", () => {
        expect(render("/*% when ./flag.typ yes %*/", ITEMS_CFG, files)).toBe(
          "flag"
        );
        expect(render("/*% when ./flag.typ no %*/", ITEMS_CFG, files)).toBe("");
        expect(render("/*% unless ./flag.typ no %*/", ITEMS_CFG, files)).toBe(
          "flag"
        );
      });

      it.each(['"./my item.typ"', "'./my item.typ'"])(
        "supports quoted paths (%s)",
        quoted => {
          expect(render(`/*% map ${quoted} ITEM %*/`, ITEMS_CFG, files)).toBe(
            "(1)(2)"
          );
        }
      );

      it("resolves nested paths relative to the containing file", () => {
        expect(
          render("/*% when ./sub/outer.typ yes %*/", ITEMS_CFG, files)
        ).toBe("[1][2]|1");
      });

      it("needs no closing tag", () => {
        expect(
          render("a/*% map ./item.typ EXPENSE %*/b", ITEMS_CFG, files)
        ).toBe("a<a>b");
      });

      it("throws if the file does not exist", () => {
        expect(() =>
          render("/*% when ./nope.typ yes %*/", ITEMS_CFG, files)
        ).toThrow(/Could not find the contents file for when/);
      });

      it("throws for missing arguments", () => {
        expect(() =>
          render("/*% map ./item.typ %*/", ITEMS_CFG, files)
        ).toThrow("map directive has a single argument");
      });

      it("does not treat an opening tag as one that reads a file", () => {
        // with a closing tag the contents are what is between the tags, so
        // `./item.typ` would just be part of the (invalid) variable name
        expect(() =>
          render("/*% when ./item.typ yes >*/x/*< when %*/", ITEMS_CFG, files)
        ).toThrow("Invalid variable");
      });
    });

    describe("inside a block of the same name", () => {
      it("is not mistaken for an opening tag", () => {
        expect(
          render(
            "/*% map ITEM >*/{{ ITEM.id }}/*% map ./item.typ EXPENSE %*/|/*< map %*/",
            ITEMS_CFG,
            files
          )
        ).toBe("1<a>|2<a>|");
      });

      it("can follow a block of the same name", () => {
        expect(
          render(
            "/*% map ITEM >*/{{ ITEM.id }}/*< map %*//*% map ./item.typ EXPENSE %*/",
            ITEMS_CFG,
            files
          )
        ).toBe("12<a>");
      });
    });
  });

  describe("map", () => {
    it("repeats the contents for each item", () => {
      expect(
        render(
          "/*% map ITEM >*/[{{ ITEM.id }}:{{ ITEM.subtotal }}]/*< map %*/",
          ITEMS_CFG
        )
      ).toBe("[1:30.00][2:6.00]");
    });

    it("exposes every option of the item", () => {
      expect(
        render(
          "/*% map ITEM >*/{{ ITEM.description }}/{{ ITEM.hrs }}/{{ ITEM.rate }};/*< map %*/",
          ITEMS_CFG
        )
      ).toBe("First/5/6.00;Second/2/3.00;");
    });

    it("is empty when there are no items with the prefix", () => {
      expect(render("[/*% map NOTHING >*/x/*< map %*/]", ITEMS_CFG)).toBe("[]");
    });

    it("keeps the outer config available inside", () => {
      expect(render("/*% map ITEM >*/{{ yes }}/*< map %*/", ITEMS_CFG)).toBe(
        "11"
      );
    });

    it("supports directives inside the contents using the item", () => {
      expect(
        render(
          "/*% map ITEM >*//*% when ITEM.recurring >*/R/*< when %*//*% unless ITEM.recurring >*/-/*< unless %*//*< map %*/",
          ITEMS_CFG
        )
      ).toBe("R-");
    });

    it("does not see the item outside of the map", () => {
      expect(
        render("/*% map ITEM >*//*< map %*/[{{ ITEM.id }}]", ITEMS_CFG)
      ).toBe("[]");
    });

    it("maps over any prefix", () => {
      expect(
        render(
          "/*% map EXPENSE >*/{{ EXPENSE.id }}={{ EXPENSE.subtotal }};/*< map %*/",
          lines("[EXPENSE_a]", "qty=2", "price=1.5")
        )
      ).toBe("a=3.00;");
    });

    it("requires an argument", () => {
      expect(() => render("/*% map >*/ x/*< map %*/")).toThrow(
        "map directive has a single argument for the context variable to check"
      );
    });

    describe("precomputed values", () => {
      it("exposes the group's values inside the contents", () => {
        expect(
          render(
            "/*% map ITEM >*/{{ ITEM.id }}/{{ ITEM_total_due }}/{{ ITEM_hrs }};/*< map %*/",
            ITEMS_CFG
          )
        ).toBe("1/36.00/5, 2;2/36.00/5, 2;");
      });

      it("works for any prefix", () => {
        expect(
          render(
            "/*% map FOO >*/{{ FOO_total_due }}/*< map %*/",
            lines("[FOO_x]", "qty=2", "price=3")
          )
        ).toBe("6.00");
      });

      it("does not depend on the order things appear in", () => {
        const before = render(
          "[{{ ITEM_total_due }}]/*% map FOO >*/{{ FOO_total_due }}/*< map %*/",
          lines(ITEMS_CFG, "[FOO_x]", "qty=2", "price=3")
        );
        const after = render(
          "/*% map FOO >*/{{ FOO_total_due }}/*< map %*/[{{ ITEM_total_due }}]",
          lines(ITEMS_CFG, "[FOO_x]", "qty=2", "price=3")
        );
        expect(before).toBe("[36.00]6.00");
        expect(after).toBe("6.00[36.00]");
      });
    });

    describe("nested maps", () => {
      it("keeps the outer item available inside", () => {
        expect(
          render(
            "/*% map ITEM >*//*% map EXPENSE >*/{{ ITEM.id }}-{{ EXPENSE.id }};/*< map %*//*< map %*/",
            ITEMS_CFG
          )
        ).toBe("1-a;2-a;");
      });

      it("lets the inner item shadow an outer one of the same prefix", () => {
        expect(
          render(
            "/*% map ITEM >*//*% map ITEM >*/{{ ITEM.id }}/*< map %*/|/*< map %*/",
            ITEMS_CFG
          )
        ).toBe("12|12|");
      });

      it("keeps the outer item in other directives inside", () => {
        expect(
          render(
            "/*% map ITEM >*//*% map EXPENSE >*//*% when ITEM.recurring >*/R/*< when %*//*< map %*/./*< map %*/",
            ITEMS_CFG
          )
        ).toBe("R..");
      });
    });
  });

  describe("add", () => {
    it("adds up the arguments of a self closing tag", () => {
      expect(
        render("/*% add ITEM_total_due EXPENSE_total_due %*/", ITEMS_CFG)
      ).toBe("56.00");
    });

    it("adds up the arguments and contents of a block", () => {
      expect(
        render(
          "/*% add ITEM_total_due >*/EXPENSE_total_due/*< add %*/",
          ITEMS_CFG
        )
      ).toBe("56.00");
      expect(
        render(
          "/*% add ITEM_total_due >*/\n  EXPENSE_total_due\n  yes\n/*< add %*/",
          ITEMS_CFG
        )
      ).toBe("57.00");
    });

    it("takes the variables from the contents alone, with no arguments", () => {
      expect(
        render(
          "/*% add >*/ITEM_total_due EXPENSE_total_due/*< add %*/",
          ITEMS_CFG
        )
      ).toBe("56.00");
    });

    it("reads group variables through the explicit META section", () => {
      expect(
        render("/*% add META.ITEM_total_due EXPENSE_total_due %*/", ITEMS_CFG)
      ).toBe("56.00");
    });

    it("counts groups that do not exist as zero", () => {
      expect(
        render("/*% add ITEM_total_due NOPE_total_due %*/", ITEMS_CFG)
      ).toBe("36.00");
    });

    it("is usable inside other directives", () => {
      expect(
        render(
          "/*% map ITEM >*//*% add ITEM.subtotal ITEM_total_due %*/|/*< map %*/",
          ITEMS_CFG
        )
      ).toBe("66.00|42.00|");
    });

    it("needs at least two variables", () => {
      expect(() => render("/*% add ITEM_total_due %*/", ITEMS_CFG)).toThrow(
        "add directive needs at least two context variables to add up"
      );
      expect(() => render("/*% add %*/", ITEMS_CFG)).toThrow(
        "add directive needs at least two context variables to add up"
      );
    });
  });
});
