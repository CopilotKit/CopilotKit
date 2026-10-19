/**
 * The functions of the A2UI 1.0 basic catalog, as the model and the
 * validator see them. The renderer implements them (react-core
 * `generative-ui/functions.ts`); this file holds only what both sides share:
 * the names, the short signatures for the schema the model reads, and who
 * may call each one.
 */

/** What a basic function gives back. */
export type A2UIBasicFunctionReturn =
  | "string"
  | "boolean"
  | "validationResult"
  | "void";

export interface A2UIBasicFunctionInfo {
  description: string;
  /** The args, as a short TypeScript-like type for the compact schema. */
  parameters: string;
  returnType: A2UIBasicFunctionReturn;
  /**
   * True for a function that only runs from a user gesture (an event
   * binding). The agent cannot call it, and a prop cannot be bound to it.
   */
  requiresUserActivation?: true;
}

/**
 * The basic functions by name. A `{"@call"}` in a prop, in an event
 * binding, or in a `callRendererFunction` may name any of them without a
 * declaration in `createGenerativeUI({ functions })`.
 */
export const A2UI_BASIC_FUNCTIONS: Readonly<
  Record<string, A2UIBasicFunctionInfo>
> = {
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
};

/** The name of the system function that gives the index of a template item. */
export const A2UI_INDEX_FUNCTION = "@index";

/** True for a basic function name, `@index` included. */
export function isA2UIBasicFunction(name: string) {
  return (
    name === A2UI_INDEX_FUNCTION ||
    Object.prototype.hasOwnProperty.call(A2UI_BASIC_FUNCTIONS, name)
  );
}

/**
 * True for a basic function that a prop or a check may call: every basic
 * function except the ones that need a user gesture.
 */
export function isA2UIValueFunction(name: string) {
  if (name === A2UI_INDEX_FUNCTION) return true;
  const info = Object.prototype.hasOwnProperty.call(A2UI_BASIC_FUNCTIONS, name)
    ? A2UI_BASIC_FUNCTIONS[name]
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

/**
 * A2UI's `ValidationResult`: what a check gives. A validator function gives
 * one; a check may also bind a boolean, which the renderer coerces to one.
 */
export interface A2UIValidationResult {
  valid: boolean;
  message?: string;
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
