import {
  A2UI_INDEX_FUNCTION,
  isActionBinding,
  isCallBinding,
  isPathBinding,
  isValidationResult,
} from "@copilotkit/shared";
import { calc, series } from "./calc";
import {
  BASIC_FUNCTIONS,
  ExpressionError,
  givesValidationResult,
  requiresUserActivation,
} from "./functions";

// The CopilotKit value functions join the registry here, because calc.ts
// uses the error type and truthOf of functions.ts.
BASIC_FUNCTIONS.calc = calc;
BASIC_FUNCTIONS.series = series;
// formatString needs the resolver. Inside a surface, `call()` below handles
// it with the surface data; this entry serves the dispatcher, where the
// agent calls it with literal args and no data model.
const NO_DATA: DataReader = { get: () => undefined };
BASIC_FUNCTIONS.formatString = (args) =>
  resolveDynamicValue(
    { "@call": "formatString", args },
    { data: NO_DATA, basePath: undefined },
  ).value;

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
 * Where a value sits with respect to `checks`: outside, in the `checks`
 * list, or in one check. Only the `condition` of a check keeps a validator
 * result as an object; an arg named `condition` elsewhere does not.
 */
type CheckScope = "outside" | "list" | "check";

/**
 * Resolves `value`. `keepValidation` keeps a ValidationResult as it is; by
 * default it becomes its `valid` boolean, which is what every prop except
 * a check condition wants.
 */
function walk(
  value: unknown,
  state: Walk,
  keepValidation: boolean,
  scope: CheckScope = "outside",
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const itemScope = scope === "list" ? "check" : "outside";
    const items = value.map((item) => {
      const next = walk(item, state, keepValidation, itemScope);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (!isRecord(value)) return value;
  if (isPathBinding(value)) {
    const path = resolvePath(value["@path"], state.context.basePath);
    state.paths.add(path);
    // A data model value is what it is: an object with a `valid` field is
    // not a validator result. Only a validator call is coerced.
    return state.context.data.get(path);
  }
  if (isCallBinding(value)) return call(value, state, keepValidation);
  // An event binding is not a value. It is resolved when the event runs.
  if (isActionBinding(value)) return value;
  let changed = false;
  const entries = Object.entries(value).map(([key, item]) => {
    // Only the condition of a check consumes a ValidationResult as an object.
    const isCondition = scope === "check" && key === "condition";
    const next = walk(
      item,
      state,
      keepValidation || isCondition,
      key === "checks" ? "list" : "outside",
    );
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
  // A value is computed whenever the data changes, never from a gesture. A
  // function that needs one (openUrl) runs only as the functionCall of an
  // event, where the dispatcher checks the gesture.
  if (requiresUserActivation(name)) {
    throw new ExpressionError(
      `"${name}" is not a value; bind it as the functionCall of an event`,
    );
  }
  // A validator result in an arg becomes its boolean: `and`, `or`, `not` and
  // `calc` all want one, and a validator reads plain values anyway.
  const args = walk(rawArgs, state, false) as Record<string, unknown>;
  const result = fn(args);
  return givesValidationResult(name) ? coerce(result, keepValidation) : result;
}

/**
 * Resolves one dynamic value: the value with every binding and function
 * call replaced, plus the data model paths it read. Throws an
 * {@link ExpressionError} for a bad function call.
 */
/** The options of a resolution. */
export interface ResolveOptions {
  /** Keep every validator result as an object. */
  keepValidation?: boolean;
  /**
   * True when `value` is the `checks` prop of a component: the condition
   * of each check then keeps its validator result as an object.
   */
  isChecks?: boolean;
}

export function resolveDynamicValue<T = unknown>(
  value: unknown,
  context: ResolveContext,
  options: ResolveOptions = {},
): Resolved<T> {
  const result = tryResolveDynamicValue<T>(value, context, options);
  if (!result.ok) throw result.error;
  return result;
}

export type ResolveAttempt<T = unknown> =
  | ({ ok: true } & Resolved<T>)
  | {
      ok: false;
      error: Error;
      /** The paths read before the failure. A change there may fix it. */
      paths: Set<string>;
    };

/**
 * Like {@link resolveDynamicValue}, but a failure comes back as a result
 * with the paths read so far, so the caller can keep watching them: a
 * function that fails on an empty field works once the user fills it.
 */
export function tryResolveDynamicValue<T = unknown>(
  value: unknown,
  context: ResolveContext,
  options: ResolveOptions = {},
): ResolveAttempt<T> {
  const state: Walk = { context, paths: new Set() };
  try {
    const resolved = walk(
      value,
      state,
      options.keepValidation ?? false,
      options.isChecks ? "list" : "outside",
    ) as T;
    return { ok: true, value: resolved, paths: state.paths };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
      paths: state.paths,
    };
  }
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
      if (char === "\\") i++;
      else if (char === quote) quote = undefined;
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
