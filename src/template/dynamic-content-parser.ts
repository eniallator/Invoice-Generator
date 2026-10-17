import { generator, raise } from "niall-utils";

import type { ContextVariables, Extra } from "./context-variables.ts";
import { DIRECTIVES, isDirectiveName } from "./directives.ts";

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// The tags are block comments, so that a template is still valid Typst wherever
// they are put. `/*% name args >*/` opens a block that is closed by
// `/*< name %*/`, whereas `/*% name args %*/` is self closing.
// Groups: 1 = name, 2 = args, 3 = ">" if it opens a block, "%" if self closing
const DIRECTIVE_RE = /\/\*%\s*(\w+)((?:\s[^%>]*)?)([%>])\*\//;

// Group 1 is the name of the directive that the closing tag is for
const CLOSING_RE = /\/\*<\s*(\w+)\s*%\*\//;

// Every tag that opens or closes a block of the directive, in order. Group 1 is
// the name for a closing tag. A self closing tag never matches as an opening
const directiveTagRe = (name: string): RegExp =>
  new RegExp(
    String.raw`\/\*<\s*(${name})\s*%\*\/|\/\*%\s*${name}(?:\s[^%>]*)?>\*\/`,
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
    const [opening, name = "", args = "", marker = ""] = match;
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

    if (marker === "%") return [run(undefined), matchEnd];

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
    const [, unopened] = CLOSING_RE.exec(current) ?? [];
    if (unopened !== undefined) {
      raise(
        new Error(
          `Found the closing directive for ${unopened}, but not its opening`
        )
      );
    }
    return current.replace(VARIABLE_RE, (_match, varId: string) =>
      this.contextVariables.getVariable(varId, this.extra)
    );
  }
}
