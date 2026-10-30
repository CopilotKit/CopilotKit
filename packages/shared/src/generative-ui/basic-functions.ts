/**
 * The functions of the A2UI 1.0 basic catalog, as the model and the
 * validator see them. The renderer implements them (react-core
 * `generative-ui/functions.ts`); this file holds only what both sides share:
 * the names, the short signatures for the schema the model reads, and who
 * may call each one.
 */

/** What a function gives back, as A2UI 1.0 names it. */
export type A2UIFunctionReturnType =
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "validationResult"
  | "any"
  | "void";

/**
 * Who may call a function. The renderer calls it from an event binding or
 * as a prop value; the agent calls it with `callRendererFunction`.
 */
export type A2UIAllowedCallers =
  | "rendererOnly"
  | "agentOnly"
  | "rendererOrAgent";

/**
 * The callers of an app function that names none: the renderer only, as
 * in A2UI 1.0. The agent calls a function with `callRendererFunction` only
 * when its declaration allows it (`"rendererOrAgent"` or `"agentOnly"`).
 * The manifests and the exported catalog write the value out.
 */
export const GENERATIVE_UI_DEFAULT_ALLOWED_CALLERS: A2UIAllowedCallers =
  "rendererOnly";

/** The A2UI 1.0 interface fields of a function: who calls it, and how. */
export interface A2UIFunctionPermissions {
  allowedCallers?: A2UIAllowedCallers;
  /**
   * True for a function that only runs from a user gesture (a click, a key
   * press). It is `rendererOnly`: the agent cannot call it, and a prop
   * cannot be bound to it.
   */
  requiresUserActivation?: boolean;
}

/**
 * Who may call a function, from its permissions. A function that needs a
 * user gesture is for the renderer only, whatever `allowedCallers` says.
 *
 * @example
 * ```ts
 * functionCallers({}); // { renderer: true, agent: true }
 * functionCallers({ allowedCallers: "rendererOnly" }); // { renderer: true, agent: false }
 * functionCallers({ requiresUserActivation: true }); // { renderer: true, agent: false }
 * ```
 */
export function functionCallers(fn: A2UIFunctionPermissions) {
  if (fn.requiresUserActivation) return { renderer: true, agent: false };
  const callers = fn.allowedCallers ?? GENERATIVE_UI_DEFAULT_ALLOWED_CALLERS;
  return {
    renderer: callers !== "agentOnly",
    agent: callers !== "rendererOnly",
  };
}

export interface A2UIBasicFunctionInfo extends A2UIFunctionPermissions {
  description: string;
  /** The args, as a short TypeScript-like type for the compact schema. */
  parameters: string;
  returnType: A2UIFunctionReturnType;
  /** Built-in functions are value functions of the renderer. */
  allowedCallers: "rendererOnly";
  requiresUserActivation?: true;
  /** True for a CopilotKit function that the A2UI basic catalog lacks. */
  extension?: true;
}

/** Marks a table of built-in functions as callable by the renderer only. */
function rendererOnly<Name extends string>(
  functions: Record<Name, Omit<A2UIBasicFunctionInfo, "allowedCallers">>,
): Readonly<Record<Name, A2UIBasicFunctionInfo>> {
  return Object.fromEntries(
    Object.entries<Omit<A2UIBasicFunctionInfo, "allowedCallers">>(
      functions,
    ).map(([name, info]) => [
      name,
      { ...info, allowedCallers: "rendererOnly" },
    ]),
  ) as Record<Name, A2UIBasicFunctionInfo>;
}

/**
 * The basic functions by name. A `{"@call"}` in a prop, in an event
 * binding, or in a `callRendererFunction` may name any of them without a
 * declaration in `createGenerativeUI({ functions })`.
 */
export const A2UI_BASIC_FUNCTIONS: Readonly<
  Record<string, A2UIBasicFunctionInfo>
> = rendererOnly({
  required: {
    description: "Valid when the value is not empty",
    parameters: "{ value: unknown }",
    returnType: "validationResult",
  },
  regex: {
    description: "Valid when the value matches the pattern",
    parameters: "{ value: string; pattern: string }",
    returnType: "validationResult",
  },
  length: {
    description: "Valid when the length of the value is within min and max",
    parameters: "{ value: string; min?: number; max?: number }",
    returnType: "validationResult",
  },
  numeric: {
    description: "Valid when the value is a number within min and max",
    parameters: "{ value: number; min?: number; max?: number }",
    returnType: "validationResult",
  },
  email: {
    description: "Valid when the value is an email address",
    parameters: "{ value: string }",
    returnType: "validationResult",
  },
  formatString: {
    description:
      "Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; \\${ is a literal",
    parameters: "{ value: string }",
    returnType: "string",
  },
  formatNumber: {
    description: "The number in the locale of the user",
    parameters: "{ value: number; decimals?: number; grouping?: boolean }",
    returnType: "string",
  },
  formatCurrency: {
    description: "The amount as money, with an ISO 4217 currency code",
    parameters:
      "{ value: number; currency: string; decimals?: number; grouping?: boolean }",
    returnType: "string",
  },
  formatDate: {
    description:
      'A date or ISO string in a TR35 pattern, for example "MMM d, yyyy" or "HH:mm"',
    parameters: "{ value: string | number; format: string }",
    returnType: "string",
  },
  pluralize: {
    description: "The string of the plural category of the value",
    parameters:
      "{ value: number; zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }",
    returnType: "string",
  },
  openUrl: {
    description: "Opens an http(s) URL in a new tab. Only from an event",
    parameters: "{ url: string }",
    returnType: "void",
    requiresUserActivation: true,
  },
  and: {
    description: "True when every value is true",
    parameters: "{ values: boolean[] }",
    returnType: "boolean",
  },
  or: {
    description: "True when any value is true",
    parameters: "{ values: boolean[] }",
    returnType: "boolean",
  },
  not: {
    description: "The negated value",
    parameters: "{ value: boolean }",
    returnType: "boolean",
  },
});

/**
 * The value functions that CopilotKit adds to the basic catalog, because
 * A2UI 1.0 has no arithmetic: `calc` evaluates an expression over named
 * args, and `series` builds a computed list. A catalog may declare its own
 * functions in A2UI, so these are regular catalog functions to the model;
 * a renderer without them rejects the call instead of misrendering.
 */
export const COPILOTKIT_FUNCTIONS: Readonly<
  Record<string, A2UIBasicFunctionInfo>
> = rendererOnly({
  calc: {
    description:
      "The value of an arithmetic expression over the other args, by name: + - * / % ( ), comparisons, && || !, cond ? a : b, min max round floor ceil abs, 'text' + name",
    parameters:
      "{ expression: string; [name: string]: number | string | boolean }",
    returnType: "any",
    extension: true,
  },
  // WORKAROUND(a2ui-agent-sdk 0.9.0): examples omit `variable` and use default i
  // because the Express compiler mistakes a literal `variable` key for its AST.
  // Runtime support for custom variable names is unchanged.
  // https://github.com/a2ui-project/a2ui/issues/3410
  series: {
    description:
      'A list of count copies of item, for chart data and template lists. Put arithmetic in ${expression} strings in item, using the loop variable (default i, counting from start, default 1) and other named args. A whole-expression string retains the result type, so "${i * monthlyCost}" yields a number. Arguments, including nested calc or formatString calls in item, resolve before the series loop; those calls cannot use the loop variable. Example: {"@call":"series","args":{"count":6,"item":{"month":"${i}","cost":"${i * monthlyCost}"},"monthlyCost":{"@path":"/monthlyCost"}}}. Omit variable to use i.',
    parameters:
      "{ count: number; item: unknown; variable?: string; start?: number; [name: string]: unknown }",
    returnType: "array",
    extension: true,
  },
});

/** Every function a `{"@call"}` may name without a declaration: basic and CopilotKit. */
export const GENERATIVE_UI_FUNCTIONS: Readonly<
  Record<string, A2UIBasicFunctionInfo>
> = { ...A2UI_BASIC_FUNCTIONS, ...COPILOTKIT_FUNCTIONS };

/** The name of the system function that gives the index of a template item. */
export const A2UI_INDEX_FUNCTION = "@index";

/** True for a built-in function name: basic, CopilotKit, or `@index`. */
export function isA2UIBasicFunction(name: string) {
  return (
    name === A2UI_INDEX_FUNCTION ||
    Object.prototype.hasOwnProperty.call(GENERATIVE_UI_FUNCTIONS, name)
  );
}

/**
 * True for a built-in function that a prop or a check may call: every one
 * except the functions that need a user gesture.
 */
export function isA2UIValueFunction(name: string) {
  if (name === A2UI_INDEX_FUNCTION) return true;
  const info = Object.prototype.hasOwnProperty.call(
    GENERATIVE_UI_FUNCTIONS,
    name,
  )
    ? GENERATIVE_UI_FUNCTIONS[name]
    : undefined;
  return info !== undefined && !info.requiresUserActivation;
}

/** `{ "@call": "<name>", "args"?: {...} }`: a function call value. */
export function isCallBinding(
  value: unknown,
): value is { "@call": string; args?: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)["@call"] === "string"
  );
}

/** How bad a failed check is. `error` is the default; only an error blocks. */
export type A2UIValidationSeverity = "error" | "warning" | "info";

/**
 * A2UI's `ValidationResult`: what a check gives. A validator function gives
 * one; a check may also bind a boolean, which the renderer coerces to one.
 * `code` names the failure for programs; `severity` says how bad it is,
 * `"error"` when left out. Other keys are allowed, for app validators that
 * carry more (a suggested value, a field path).
 */
export interface A2UIValidationResult {
  valid: boolean;
  message?: string;
  code?: string;
  severity?: A2UIValidationSeverity;
  [extra: string]: unknown;
}

export function isValidationResult(
  value: unknown,
): value is A2UIValidationResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).valid === "boolean"
  );
}
