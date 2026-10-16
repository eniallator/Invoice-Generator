import { raise } from "niall-utils";

import type { ContextVariables, Extra } from "./context-variables.ts";
import { DIRECTIVES, isDirectiveName } from "./directives.ts";

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// `{* name args *}` opens a block that is closed by `{/* name *}`, whereas
// `{* name args */}` is self closing.
// Groups: 1 = name, 2 = args, 3 = "/" if self closing
const DIRECTIVE_RE = /\{\*\s*(\w+)((?:\s[^*]*)?)\*(\/?)\}/;

// Only block openings: a self closing `*/}` never matches
const openingDirectiveRe = (name: string): RegExp =>
  new RegExp(String.raw`\{\*\s*${name}(?:\s[^*]*)?\*\}`, "g");

const closingDirectiveRe = (name: string): RegExp =>
  new RegExp(String.raw`\{/\*\s*${name}\s*\*\}`);

/** Finds the end of the contents and of the closing tag, skipping nested directives of the same name */
const findClosingDirective = (
  template: string,
  name: string,
  contentsStart: number
): { contentsEnd: number; end: number } => {
  const closingRe = closingDirectiveRe(name);
  let depth = 1;
  let searchFrom = contentsStart;
  for (;;) {
    const close =
      closingRe.exec(template.slice(searchFrom)) ??
      raise(new Error(`Could not find the closing directive for ${name}`));
    const closeStart = searchFrom + close.index;
    const closeEnd = closeStart + close[0].length;
    const nestedOpenings = [
      ...template
        .slice(searchFrom, closeStart)
        .matchAll(openingDirectiveRe(name)),
    ].length;
    depth += nestedOpenings - 1;
    if (depth <= 0) return { contentsEnd: closeStart, end: closeEnd };
    searchFrom = closeEnd;
  }
};

export class DynamicContentParser {
  private readonly contextVariables: ContextVariables;
  private readonly basePath: string;
  private readonly extra: Extra;

  constructor(
    contextVariables: ContextVariables,
    basePath: string,
    extra: Extra = new Map()
  ) {
    this.contextVariables = contextVariables;
    this.basePath = basePath;
    this.extra = extra;
  }

  private insertDirective(
    match: RegExpExecArray,
    templateContents: string
  ): [replacement: string, end: number] {
    const [opening, name = "", args = "", selfClosing = ""] = match;
    if (!isDirectiveName(name)) {
      raise(new Error(`Unknown directive: ${name}`));
    }
    const run = (contents: string | undefined) =>
      DIRECTIVES[name]({
        args: args.trim() === "" ? undefined : args.trim(),
        contents,
        basePath: this.basePath,
        contextVariables: this.contextVariables,
        extra: this.extra,
        parse: (parsed, basePath, extra) =>
          new DynamicContentParser(
            this.contextVariables,
            basePath,
            extra
          ).parseString(parsed),
      });
    const matchEnd = match.index + opening.length;

    if (selfClosing !== "") return [run(undefined), matchEnd];

    const { contentsEnd, end } = findClosingDirective(
      templateContents,
      name,
      matchEnd
    );
    return [run(templateContents.slice(matchEnd, contentsEnd)), end];
  }

  parseString(contents: string): string {
    let current = contents;
    for (
      let match = DIRECTIVE_RE.exec(current);
      match !== null;
      match = DIRECTIVE_RE.exec(current)
    ) {
      const [replacement, end] = this.insertDirective(match, current);
      current =
        current.slice(0, match.index) + replacement + current.slice(end);
    }
    return current.replace(VARIABLE_RE, (_match, varId: string) =>
      this.contextVariables.getVariable(varId, this.extra)
    );
  }
}
