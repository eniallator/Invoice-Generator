import { dirname } from "node:path";
import { raise } from "niall-utils";

import type { ContextVariables, Extra, Item } from "./context-variables.ts";
import { isFile, parseItemPath, readText } from "./io.ts";
import { formatFixed2, parseFloatStrict } from "./numbers.ts";

export interface DirectiveInput {
  /** Everything after the directive's name, trimmed, or undefined if there is nothing */
  args: string | undefined;
  /** Everything between the opening and closing tags as is, or undefined if the directive is self closing */
  contents: string | undefined;
  /** What relative paths are resolved against */
  basePath: string;
  contextVariables: ContextVariables;
  extra: Extra;
  /** Parses the contents with a fresh parser whose relative paths start from `basePath` */
  parse: (contents: string, basePath: string, extra: Extra) => string;
}

export type Directive = (input: DirectiveInput) => string;

const requireArgs = (name: DirectiveName, args: string | undefined): string =>
  args ??
  raise(
    new Error(
      `${name} directive has a single argument for the context variable to check`
    )
  );

const CONTENTS_FILE_PATH_RE = /^("[^"]+"|'[^']+'|\S+)/;

// For directives that opt in to taking their contents from a file. The contents
// are whatever is between the tags, but a self closing directive has none, so
// its first argument is the path of the file that has them instead:
// `{* name ./contents.tex args */}`. Any other arguments are returned as `args`.
const withContentsFile = (
  name: DirectiveName,
  { args, contents, basePath }: DirectiveInput
): { args: string | undefined; contents: string; contentsPath: string } => {
  if (contents !== undefined) return { args, contents, contentsPath: basePath };

  const match =
    CONTENTS_FILE_PATH_RE.exec(args ?? "") ??
    raise(
      new Error(
        `${name} directive needs contents between its tags or the path of a contents file`
      )
    );
  const filePath = parseItemPath(match[0], basePath);
  if (!isFile(filePath)) {
    raise(
      new Error(`Could not find the contents file for ${name}: ${filePath}`)
    );
  }
  const rest = match.input.slice(match[0].length).trim();
  return {
    args: rest === "" ? undefined : rest,
    contents: readText(filePath),
    contentsPath: dirname(filePath),
  };
};

const ADD_EXPECTED = "needs at least two context variables to add up";

// Adds up two or more context variables, separated by whitespace, which can be
// in its arguments, its contents or both (they are joined together):
// `{* add ITEM_total_due EXPENSE_total_due */}`,
// `{* add ITEM_total_due *}EXPENSE_total_due{/* add *}` or
// `{* add *}ITEM_total_due EXPENSE_total_due{/* add *}`. Empty or missing
// variables count as zero, and the total is shown to 2 decimal places.
const add: Directive = ({
  args = "",
  contents = "",
  contextVariables,
  extra,
}) => {
  const variables = `${args} ${contents}`
    .split(/\s+/)
    .filter(variable => variable !== "");
  if (variables.length < 2) {
    raise(new Error(`add directive ${ADD_EXPECTED}`));
  }
  return formatFixed2(
    variables
      .map(variable => contextVariables.getVariable(variable, extra))
      .reduce(
        (total, value) => total + (value === "" ? 0 : parseFloatStrict(value)),
        0
      )
  );
};

/**
 * Repeats the contents for every section named `<args>_<id>`, in alphabetical
 * order. Each repetition has the section's options (along with the computed id,
 * subtotal etc.) as `<args>.<option>`, on top of everything the surrounding
 * directives already provide, so nested maps can still see the outer item.
 */
const map: Directive = input => {
  const { args, contents, contentsPath } = withContentsFile("map", input);
  const prefix = requireArgs("map", args);
  return input.contextVariables
    .calculateItems(prefix)
    .map(item =>
      input.parse(
        contents,
        contentsPath,
        new Map<string, Item>([...input.extra, [prefix, item]])
      )
    )
    .join("");
};

const when: Directive = input => {
  const { args, contents, contentsPath } = withContentsFile("when", input);
  return input.contextVariables.getVariable(
    requireArgs("when", args),
    input.extra
  ) !== ""
    ? input.parse(contents, contentsPath, input.extra)
    : "";
};

const unless: Directive = input => {
  const { args, contents, contentsPath } = withContentsFile("unless", input);
  return input.contextVariables.getVariable(
    requireArgs("unless", args),
    input.extra
  ) !== ""
    ? ""
    : input.parse(contents, contentsPath, input.extra);
};

export const DIRECTIVES = {
  add,
  map,
  unless,
  when,
} as const satisfies Record<string, Directive>;

export type DirectiveName = keyof typeof DIRECTIVES;

export const isDirectiveName = (name: string): name is DirectiveName =>
  Object.hasOwn(DIRECTIVES, name);
