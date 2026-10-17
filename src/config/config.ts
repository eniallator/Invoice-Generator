import { attempt, raise, tuple } from "niall-utils";

import { readText } from "../io.ts";
import { parseFloatStrict } from "../numbers.ts";

export const DEFAULT_SECTION = "DEFAULT";

type Section = Map<string, string>;

const COMMENT_PREFIXES = ["#", ";"];
const SECTION_RE = /^\[(.+)\]/;
const OPTION_RE = /^([^=:]*)[=:]\s*(.*)$/;

const parseIni = (
  text: string,
  source: string
): { defaults: Section; sections: Map<string, Section> } => {
  const rawDefaults = new Map<string, string[]>();
  const rawSections = new Map<string, Map<string, string[]>>();

  let current: { name: string; options: Map<string, string[]> } | undefined;
  let optionLines: string[] | undefined;
  let indentLevel = 0;

  for (const [index, line] of text.split("\n").entries()) {
    const where = `${source}, line ${index + 1}`;
    const stripped = line.trim();
    const isComment = COMMENT_PREFIXES.some(prefix =>
      stripped.startsWith(prefix)
    );
    const value = isComment ? "" : stripped;

    if (value === "") {
      if (!isComment) optionLines?.push("");
      continue;
    }

    const indent = Math.max(line.search(/\S/), 0);
    if (optionLines !== undefined && indent > indentLevel) {
      optionLines.push(value);
      continue;
    }
    indentLevel = indent;

    const sectionMatch = SECTION_RE.exec(value);
    if (sectionMatch !== null) {
      const [, name = ""] = sectionMatch;
      if (name === DEFAULT_SECTION) {
        current = { name, options: rawDefaults };
      } else if (rawSections.has(name)) {
        throw new Error(`${where}: duplicate section '${name}'`);
      } else {
        const options = new Map<string, string[]>();
        rawSections.set(name, options);
        current = { name, options };
      }
      optionLines = undefined;
      continue;
    }

    if (current === undefined) {
      throw new Error(`${where}: file contains no section headers`);
    }
    const [, rawName = "", rawValue = ""] = OPTION_RE.exec(value) ?? [];
    const name = rawName.trimEnd().toLowerCase();
    if (name === "") {
      throw new Error(`${where}: could not parse '${value}'`);
    }
    if (current.options.has(name)) {
      throw new Error(
        `${where}: duplicate option '${name}' in '${current.name}'`
      );
    }
    optionLines = [rawValue.trim()];
    current.options.set(name, optionLines);
  }

  const finalise = (raw: Map<string, string[]>): Section =>
    new Map(
      [...raw].map(([key, lines]) => tuple(key, lines.join("\n").trimEnd()))
    );

  return {
    defaults: finalise(rawDefaults),
    sections: new Map(
      [...rawSections].map(([name, raw]) => tuple(name, finalise(raw)))
    ),
  };
};

/** Minimal port of Python's `ConfigParser` (no interpolation) */
export class Config {
  private readonly defaults: Section;
  private readonly sections: Map<string, Section>;

  constructor(
    defaults: Section = new Map(),
    sections: Map<string, Section> = new Map()
  ) {
    this.defaults = defaults;
    this.sections = sections;
  }

  /** Undefined if the file could not be opened */
  static read(filePath: string): Config | undefined {
    const text = attempt(() => readText(filePath));
    if (text === null) return undefined;
    const { defaults, sections } = parseIni(text, filePath);
    return new Config(defaults, sections);
  }

  private section(name: string): Section | undefined {
    return name === DEFAULT_SECTION ? this.defaults : this.sections.get(name);
  }

  private sectionOrThrow(name: string): Section {
    return this.section(name) ?? raise(new Error(`No section: '${name}'`));
  }

  sectionNames(): string[] {
    return [DEFAULT_SECTION, ...this.sections.keys()];
  }

  /** Includes the default section */
  contains(name: string): boolean {
    return this.section(name) !== undefined;
  }

  hasSection(name: string): boolean {
    return this.sections.has(name);
  }

  addSection(name: string): void {
    if (name === DEFAULT_SECTION || this.sections.has(name)) {
      raise(new Error(`Section '${name}' already exists`));
    }
    this.sections.set(name, new Map());
  }

  options(name: string): string[] {
    return [...this.items(name).keys()];
  }

  hasOption(name: string, key: string): boolean {
    return this.get(name, key) !== undefined;
  }

  items(name: string): Section {
    return new Map([...this.defaults, ...this.sectionOrThrow(name)]);
  }

  get(name: string, key: string): string | undefined {
    const lowerKey = key.toLowerCase();
    return this.section(name)?.get(lowerKey) ?? this.defaultFor(name, lowerKey);
  }

  getFloat(name: string, key: string, fallback: number): number {
    const value = this.get(name, key);
    return value === undefined ? fallback : parseFloatStrict(value);
  }

  set(name: string, key: string, value: string): void {
    this.sectionOrThrow(name).set(key.toLowerCase(), value);
  }

  /** Copies every option of `other` over this config, creating missing sections */
  merge(other: Config): void {
    for (const name of other.sectionNames()) {
      if (!this.contains(name)) this.addSection(name);
      for (const [key, value] of other.items(name)) this.set(name, key, value);
    }
  }

  private defaultFor(name: string, lowerKey: string): string | undefined {
    return this.section(name) === undefined
      ? undefined
      : this.defaults.get(lowerKey);
  }
}
