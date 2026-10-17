import { generator, raise } from "niall-utils";

import type { ContextVariables, Extra } from "./context-variables.ts";
import { DIRECTIVES, isDirectiveName } from "./directives.ts";

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// `{* name args *}` opens a block that is closed by `{/* name *}`, whereas
// `{* name args */}` is self closing.
// Groups: 1 = name, 2 = args, 3 = "/" if self closing
const DIRECTIVE_RE = /\{\*\s*(\w+)((?:\s[^*]*)?)\*(\/?)\}/;

// Every opening or closing tag of a directive, in order. Group 1 is "/" for a
// closing tag. A self closing `*/}` never matches as an opening
const directiveTagRe = (name: string): RegExp =>
  new RegExp(
    String.raw`\{(/)\*\s*${name}\s*\*\}|\{\*\s*${name}(?:\s[^*]*)?\*\}`,
    "g"
  );

/** Finds the end of the contents and of the closing tag, skipping nested directives of the same name */
const findClosingDirective = (
  template: string,
  name: string,
  contentsStart: number
): { contentsEnd: number; end: number } => {
  let depth = 1;
  for (const tag of template
    .slice(contentsStart)
    .matchAll(directiveTagRe(name))) {
    depth += tag[1] === undefined ? 1 : -1;
    if (depth === 0) {
      const contentsEnd = contentsStart + tag.index;
      return { contentsEnd, end: contentsEnd + tag[0].length };
    }
  }
  return raise(new Error(`Could not find the closing directive for ${name}`));
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
    if (!isDirectiveName(name)) raise(new Error(`Unknown directive: ${name}`));

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
    for (const match of generator(() => DIRECTIVE_RE.exec(current))) {
      const [replacement, end] = this.insertDirective(match, current);
      current =
        current.slice(0, match.index) + replacement + current.slice(end);
    }
    return current.replace(VARIABLE_RE, (_match, varId: string) =>
      this.contextVariables.getVariable(varId, this.extra)
    );
  }
}
