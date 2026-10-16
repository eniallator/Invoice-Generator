import { dirname } from "node:path";
import { raise } from "niall-utils";

import type { ContextVariables, Extra } from "./context-variables.ts";
import { DIRECTIVES, isDirectiveName } from "./directives.ts";
import { isFile, parseItemPath, readText } from "./io.ts";

const VARIABLE_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

// Groups: 1 = name, 2 = rest, 3 = file path, 4 = args
const directivePattern = (name: string): string =>
  String.raw`\{\*\s*${name}\s+(("[^"]+"|'[^']+'|[^\s"]+)?\s*([^*]+)?)\s*\*\}`;

const DIRECTIVE_RE = new RegExp(directivePattern(String.raw`(\w+)`));

const openingDirectiveRe = (name: string): RegExp =>
  new RegExp(directivePattern(name), "g");

const closingDirectiveRe = (name: string): RegExp =>
  new RegExp(String.raw`\{/\*\s*${name}\s*\*\}`);

const sanitizeArgs = (args: string | undefined): string | undefined => {
  const trimmed = args?.trim();
  return trimmed === "" ? undefined : trimmed;
};

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
    const [opening, name = "", rest, rawFilePath, args] = match;
    const directive = isDirectiveName(name)
      ? DIRECTIVES[name]
      : raise(new Error(`Unknown directive: ${name}`));
    const run = (contents: string, contentsPath: string, rawArgs?: string) =>
      directive({
        args: sanitizeArgs(rawArgs),
        contents,
        contentsPath,
        contextVariables: this.contextVariables,
        extra: this.extra,
        parse: (parsed, path, extra) =>
          new DynamicContentParser(
            this.contextVariables,
            path,
            extra
          ).parseString(parsed),
      });
    const matchEnd = match.index + opening.length;

    const filePath =
      rawFilePath === undefined
        ? undefined
        : parseItemPath(rawFilePath, this.basePath);
    if (filePath !== undefined && isFile(filePath)) {
      return [run(readText(filePath), dirname(filePath), args), matchEnd];
    }

    const { contentsEnd, end } = findClosingDirective(
      templateContents,
      name,
      matchEnd
    );
    return [
      run(templateContents.slice(matchEnd, contentsEnd), this.basePath, rest),
      end,
    ];
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
