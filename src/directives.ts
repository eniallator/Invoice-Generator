import { raise } from "niall-utils";

import type { ContextVariables, Extra } from "./context-variables.ts";

export interface DirectiveInput {
  args: string | undefined;
  contents: string;
  contentsPath: string;
  contextVariables: ContextVariables;
  extra: Extra;
  /** Parses the contents with a fresh parser rooted at `contentsPath` */
  parse: (contents: string, contentsPath: string, extra: Extra) => string;
}

export type Directive = (input: DirectiveInput) => string;

export type DirectiveName = "map" | "when" | "unless";

const requireArgs = (name: DirectiveName, args: string | undefined): string =>
  args ??
  raise(
    new Error(
      `${name} directive has a single argument for the context variable to check`
    )
  );

const map: Directive = ({
  args,
  contents,
  contentsPath,
  contextVariables,
  parse,
}) => {
  const prefix = requireArgs("map", args);
  // TODO: Get variable first, then calculate var if it doesn't exist and can be calculated
  // ALSO iterate over the item_Ns
  return contextVariables
    .calculateItems(prefix)
    .map(item => parse(contents, contentsPath, new Map([[prefix, item]])))
    .join("");
};

const when: Directive = ({
  args,
  contents,
  contentsPath,
  contextVariables,
  extra,
  parse,
}) =>
  contextVariables.getVariable(requireArgs("when", args), extra) !== ""
    ? parse(contents, contentsPath, extra)
    : "";

const unless: Directive = ({
  args,
  contents,
  contentsPath,
  contextVariables,
  extra,
  parse,
}) =>
  contextVariables.getVariable(requireArgs("unless", args), extra) !== ""
    ? ""
    : parse(contents, contentsPath, extra);

export const DIRECTIVES: Record<DirectiveName, Directive> = {
  map,
  unless,
  when,
};

export const isDirectiveName = (name: string): name is DirectiveName =>
  Object.hasOwn(DIRECTIVES, name);
