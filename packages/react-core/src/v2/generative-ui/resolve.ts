import {
  A2UI_INDEX_FUNCTION,
  isActionBinding,
  isCallBinding,
  isPathBinding,
  isValidationResult,
} from "@copilotkit/shared";
import {
  BASIC_FUNCTIONS,
  ExpressionError,
  givesValidationResult,
  requiresUserActivation,
} from "./functions";

/**
 * Resolves the dynamic values of A2UI 1.0 in a prop, an event context, or
 * a function argument: `{"@path"}` bindings read the data model,
 * `{"@call"}` values run a basic function, and `formatString` interpolates
 * `${...}` expressions. Objects and arrays are walked, so a binding can sit
 * at any depth. A value with nothing dynamic in it keeps its identity.
 */

/** Reads the data model. The surface data model of web_core fits. */
export interface DataReader {
  get(path: string): unknown;
}

export interface ResolveContext {
  data: DataReader;
  /**
   * The data model path of the template item this value belongs to, or
   * `undefined` outside of a template. Relative paths resolve against it.
   */
  basePath: string | undefined;
  /**
   * Set while a user gesture runs an event binding. Lets a function that
   * needs user activation (`openUrl`) run.
   */
  userActivation?: boolean;
}

export interface Resolved<T = unknown> {
  value: T;
  /** The absolute data model paths that the value read. */
  paths: Set<string>;
}

/** Adds one segment to a JSON pointer: ("/items", "0") gives "/items/0". */
export function joinPath(base: string, segment: string) {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}

/**
 * The absolute data model path of a binding. A path without a leading "/"
 * is relative to the current template item, or to the root outside of one.
 */
export function resolvePath(path: string, basePath: string | undefined) {
  if (path.startsWith("/")) return path;
  return joinPath(basePath ?? "/", path);
}

/**
 * The index of the template item at `basePath`: its last segment.
 * `undefined` outside of a template.
 */
export function templateIndex(basePath: string | undefined) {
  if (basePath === undefined) return undefined;
  const index = Number(basePath.slice(basePath.lastIndexOf("/") + 1));
  return Number.isInteger(index) ? index : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value of a ValidationResult where a boolean is expected. */
function coerce(value: unknown, keep: boolean) {
  return !keep && isValidationResult(value) ? value.valid : value;
}

interface Walk {
  context: ResolveContext;
  paths: Set<string>;
}

/**
 * Resolves `value`. `keepValidation` keeps a ValidationResult as it is; by
 * default it becomes its `valid` boolean, which is what every prop except
 * a check condition wants.
 */
function walk(value: unknown, state: Walk, keepValidation: boolean): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = walk(item, state, keepValidation);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (!isRecord(value)) return value;
  if (isPathBinding(value)) {
    const path = resolvePath(value["@path"], state.context.basePath);
    state.paths.add(path);
    return coerce(state.context.data.get(path), keepValidation);
  }
  if (isCallBinding(value)) return call(value, state, keepValidation);
  // An event binding is not a value. It is resolved when the event runs.
  if (isActionBinding(value)) return value;
  let changed = false;
  const entries = Object.entries(value).map(([key, item]) => {
    // Only a check condition consumes a ValidationResult as an object.
    const next = walk(item, state, keepValidation || key === "condition");
    if (next !== item) changed = true;
    return [key, next] as const;
  });
  return changed ? Object.fromEntries(entries) : value;
}

function call(
  binding: { "@call": string; args?: Record<string, unknown> },
  state: Walk,
  keepValidation: boolean,
) {
  const name = binding["@call"];
  const rawArgs = binding.args ?? {};
  if (!isRecord(rawArgs)) {
    throw new ExpressionError(`the args of "${name}" must be an object`);
  }
  if (name === A2UI_INDEX_FUNCTION) {
    const index = templateIndex(state.context.basePath);
    if (index === undefined) return undefined;
    const offset = walk(rawArgs.offset, state, false);
    return index + (typeof offset === "number" ? offset : 0);
  }
  if (name === "formatString") {
    const template = walk(rawArgs.value, state, false);
    if (typeof template !== "string") {
      throw new ExpressionError("formatString takes a string value");
    }
    return formatString(template, state);
  }
  const fn = Object.prototype.hasOwnProperty.call(BASIC_FUNCTIONS, name)
    ? BASIC_FUNCTIONS[name]
    : undefined;
  if (!fn) throw new ExpressionError(`"${name}" is not a basic function`);
  if (requiresUserActivation(name) && !state.context.userActivation) {
    throw new ExpressionError(`"${name}" runs only from a user gesture`);
  }
  // The args of a validator are plain values; the args of and/or/not may be
  // ValidationResults, which the functions coerce themselves.
  const args = walk(rawArgs, state, true) as Record<string, unknown>;
  const result = fn(args);
  return givesValidationResult(name) ? coerce(result, keepValidation) : result;
}

/**
 * Resolves one dynamic value: the value with every binding and function
 * call replaced, plus the data model paths it read. Throws an
 * {@link ExpressionError} for a bad function call.
 */
export function resolveDynamicValue<T = unknown>(
  value: unknown,
  context: ResolveContext,
  options: { keepValidation?: boolean } = {},
): Resolved<T> {
  const state: Walk = { context, paths: new Set() };
  const resolved = walk(value, state, options.keepValidation ?? false) as T;
  return { value: resolved, paths: state.paths };
}

/** True when `value` holds a `{"@path"}` or `{"@call"}` at any depth. */
export function containsDynamicValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDynamicValue);
  if (!isRecord(value)) return false;
  if (isPathBinding(value) || isCallBinding(value)) return true;
  if (isActionBinding(value)) return false;
  return Object.values(value).some(containsDynamicValue);
}

// ---- formatString ----

/**
 * The `${...}` grammar of `formatString`:
 *
 *   expression := path | literal | call
 *   path       := "/" segments | identifier ("/" segments)*
 *   literal    := 'text' | "text" | number | true | false | null
 *   call       := identifier "(" [ name ":" expression ("," name ":" expression)* ] ")"
 *
 * A `\${` in the template is a literal `${`.
 */
function formatString(template: string, state: Walk) {
  let out = "";
  let index = 0;
  while (index < template.length) {
    const start = template.indexOf("${", index);
    if (start === -1) {
      out += template.slice(index);
      break;
    }
    if (start > 0 && template[start - 1] === "\\") {
      out += `${template.slice(index, start - 1)}\${`;
      index = start + 2;
      continue;
    }
    out += template.slice(index, start);
    const end = matchingBrace(template, start + 2);
    if (end === -1) throw new ExpressionError("formatString: unclosed ${");
    const expression = template.slice(start + 2, end).trim();
    const parser = new ExpressionParser(expression, state);
    const value = parser.parse();
    out += value === undefined || value === null ? "" : String(value);
    index = end + 1;
  }
  return out;
}

/** The index of the `}` that closes the block opened at `from`, or -1. */
function matchingBrace(template: string, from: number) {
  let depth = 1;
  let quote: string | undefined;
  for (let i = from; i < template.length; i++) {
    const char = template[i];
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

const IDENTIFIER = /@?[A-Za-z_][A-Za-z0-9_-]*/y;
const NUMBER = /-?\d+(?:\.\d+)?/y;
const PATH_SEGMENT = /[^\s,():'"]+/y;

class ExpressionParser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly state: Walk,
  ) {}

  parse(): unknown {
    const value = this.expression();
    this.skipSpace();
    if (this.pos < this.source.length) {
      throw new ExpressionError(
        `formatString: unexpected "${this.source.slice(this.pos)}" in \${${this.source}}`,
      );
    }
    return value;
  }

  private fail(what: string): never {
    throw new ExpressionError(`formatString: ${what} in \${${this.source}}`);
  }

  private skipSpace() {
    while (this.pos < this.source.length && /\s/.test(this.source[this.pos])) {
      this.pos++;
    }
  }

  private match(pattern: RegExp) {
    pattern.lastIndex = this.pos;
    const found = pattern.exec(this.source);
    if (!found) return undefined;
    this.pos = pattern.lastIndex;
    return found[0];
  }

  private expression(): unknown {
    this.skipSpace();
    const char = this.source[this.pos];
    if (char === undefined) this.fail("missing expression");
    if (char === "'" || char === '"') return this.quoted(char);
    if (char === "/") return this.path(this.match(PATH_SEGMENT) ?? "/");
    const number = this.match(NUMBER);
    if (number !== undefined) return Number(number);
    const name = this.match(IDENTIFIER);
    if (name === undefined) this.fail(`unexpected "${char}"`);
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "null") return null;
    this.skipSpace();
    if (this.source[this.pos] === "(") return this.call(name);
    // A system function such as @index needs no parentheses.
    if (name.startsWith("@")) return call({ "@call": name }, this.state, false);
    // A relative path: "name" or "name/more".
    const rest = this.source[this.pos] === "/" ? this.match(PATH_SEGMENT) : "";
    return this.path(`${name}${rest ?? ""}`);
  }

  private quoted(quote: string) {
    let value = "";
    this.pos++;
    while (this.pos < this.source.length) {
      const char = this.source[this.pos++];
      if (char === "\\" && this.pos < this.source.length) {
        value += this.source[this.pos++];
      } else if (char === quote) {
        return value;
      } else {
        value += char;
      }
    }
    return this.fail("unclosed string");
  }

  private path(path: string) {
    const absolute = resolvePath(path, this.state.context.basePath);
    this.state.paths.add(absolute);
    return this.state.context.data.get(absolute);
  }

  private call(name: string): unknown {
    this.pos++; // (
    const args: Record<string, unknown> = {};
    this.skipSpace();
    if (this.source[this.pos] === ")") {
      this.pos++;
      return call({ "@call": name, args }, this.state, false);
    }
    for (;;) {
      this.skipSpace();
      const key = this.match(IDENTIFIER);
      if (key === undefined) this.fail("expected an argument name");
      this.skipSpace();
      if (this.source[this.pos] !== ":") this.fail(`expected ":" after ${key}`);
      this.pos++;
      args[key] = this.expression();
      this.skipSpace();
      const next = this.source[this.pos++];
      if (next === ")") break;
      if (next !== ",") this.fail(`expected "," or ")" after ${key}`);
    }
    return call({ "@call": name, args }, this.state, false);
  }
}
