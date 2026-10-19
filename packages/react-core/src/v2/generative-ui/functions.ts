import { A2UI_BASIC_FUNCTIONS, isValidationResult } from "@copilotkit/shared";
import type { A2UIValidationResult } from "@copilotkit/shared";

/**
 * The renderer-side functions of the A2UI 1.0 basic catalog. Each one takes
 * resolved args (no bindings left in them) and gives a plain value. They
 * run synchronously, so a prop bound to one updates in the same render as
 * the data it reads. The signatures the model sees are in
 * `@copilotkit/shared` (`A2UI_BASIC_FUNCTIONS`).
 */

/** Thrown for a bad call: an unknown function, bad args, or a bad value. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

export type BasicFunction = (args: Record<string, unknown>) => unknown;

/** The boolean of a DynamicBoolean: a ValidationResult counts as `valid`. */
export function truthOf(value: unknown): boolean {
  if (isValidationResult(value)) return value.valid;
  return Boolean(value);
}

const valid = (): A2UIValidationResult => ({ valid: true });
const invalid = (message: string): A2UIValidationResult => ({
  valid: false,
  message,
});

function text(value: unknown) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

function numberOf(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function optionalNumber(value: unknown, name: string) {
  if (value === undefined || value === null) return undefined;
  const parsed = numberOf(value);
  if (Number.isNaN(parsed))
    throw new ExpressionError(`${name} must be a number`);
  return parsed;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The locale of the user. `undefined` lets Intl pick the default. */
function locale() {
  return typeof navigator !== "undefined" ? navigator.language : undefined;
}

function numberFormat(
  args: Record<string, unknown>,
  options: Intl.NumberFormatOptions,
) {
  const decimals = optionalNumber(args.decimals, "decimals");
  return new Intl.NumberFormat(locale(), {
    ...options,
    useGrouping: args.grouping !== false,
    ...(decimals === undefined
      ? {}
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
  });
}

/** A date from an ISO string, a timestamp, or a Date. */
function dateOf(value: unknown) {
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : typeof value === "string"
          ? new Date(
              /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value,
            )
          : undefined;
  if (date === undefined || Number.isNaN(date.getTime())) {
    throw new ExpressionError("value must be a date");
  }
  return date;
}

const pad = (value: number, width: number) =>
  String(value).padStart(width, "0");

/**
 * The TR35 tokens that `formatDate` takes, longest first so that "MMMM"
 * wins over "MM". Text in single quotes is literal.
 */
const DATE_TOKEN =
  /yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|E|HH|H|hh|h|mm|ss|a|'(?:[^']|'')*'/g;

function formatDatePattern(date: Date, pattern: string) {
  const parts = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale(), options).format(date);
  const hours12 = date.getHours() % 12 || 12;
  return pattern.replace(DATE_TOKEN, (token) => {
    switch (token) {
      case "yyyy":
        return String(date.getFullYear());
      case "yy":
        return pad(date.getFullYear() % 100, 2);
      case "MMMM":
        return parts({ month: "long" });
      case "MMM":
        return parts({ month: "short" });
      case "MM":
        return pad(date.getMonth() + 1, 2);
      case "M":
        return String(date.getMonth() + 1);
      case "dd":
        return pad(date.getDate(), 2);
      case "d":
        return String(date.getDate());
      case "EEEE":
        return parts({ weekday: "long" });
      case "E":
        return parts({ weekday: "short" });
      case "HH":
        return pad(date.getHours(), 2);
      case "H":
        return String(date.getHours());
      case "hh":
        return pad(hours12, 2);
      case "h":
        return String(hours12);
      case "mm":
        return pad(date.getMinutes(), 2);
      case "ss":
        return pad(date.getSeconds(), 2);
      case "a":
        return date.getHours() < 12 ? "AM" : "PM";
      default:
        // 'quoted text', with '' as one quote.
        return token.slice(1, -1).replace(/''/g, "'");
    }
  });
}

/** Opens an http(s) URL in a new tab. Any other scheme is refused. */
export function openUrlSafely(url: unknown) {
  if (typeof url !== "string" || url === "") {
    throw new ExpressionError("url must be a string");
  }
  if (typeof window === "undefined") return;
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new ExpressionError(`"${url}" is not a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ExpressionError(
      `openUrl takes only http(s) URLs, not ${parsed.protocol}`,
    );
  }
  window.open(parsed.href, "_blank", "noopener,noreferrer");
}

/** The basic functions, except `formatString`, which needs the resolver. */
export const BASIC_FUNCTIONS: Readonly<Record<string, BasicFunction>> = {
  required: ({ value }) => {
    const isEmpty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    return isEmpty ? invalid("Required") : valid();
  },
  regex: ({ value, pattern }) => {
    if (typeof pattern !== "string") {
      throw new ExpressionError("pattern must be a string");
    }
    let expression: RegExp;
    try {
      expression = new RegExp(pattern, "u");
    } catch {
      throw new ExpressionError(`"${pattern}" is not a regular expression`);
    }
    return expression.test(text(value)) ? valid() : invalid("Invalid format");
  },
  length: ({ value, min, max }) => {
    const size = text(value).length;
    const low = optionalNumber(min, "min");
    const high = optionalNumber(max, "max");
    if (low !== undefined && size < low)
      return invalid(`At least ${low} characters`);
    if (high !== undefined && size > high)
      return invalid(`At most ${high} characters`);
    return valid();
  },
  numeric: ({ value, min, max }) => {
    const parsed = numberOf(value);
    if (Number.isNaN(parsed)) return invalid("Must be a number");
    const low = optionalNumber(min, "min");
    const high = optionalNumber(max, "max");
    if (low !== undefined && parsed < low) return invalid(`At least ${low}`);
    if (high !== undefined && parsed > high) return invalid(`At most ${high}`);
    return valid();
  },
  email: ({ value }) =>
    EMAIL.test(text(value)) ? valid() : invalid("Invalid email address"),
  formatNumber: (args) => {
    const parsed = numberOf(args.value);
    if (Number.isNaN(parsed))
      throw new ExpressionError("value must be a number");
    return numberFormat(args, {}).format(parsed);
  },
  formatCurrency: (args) => {
    const parsed = numberOf(args.value);
    if (Number.isNaN(parsed))
      throw new ExpressionError("value must be a number");
    if (typeof args.currency !== "string" || args.currency === "") {
      throw new ExpressionError("currency must be an ISO 4217 code");
    }
    try {
      return numberFormat(args, {
        style: "currency",
        currency: args.currency,
      }).format(parsed);
    } catch {
      throw new ExpressionError(`"${args.currency}" is not a currency code`);
    }
  },
  formatDate: ({ value, format }) => {
    if (typeof format !== "string") {
      throw new ExpressionError("format must be a string");
    }
    return formatDatePattern(dateOf(value), format);
  },
  pluralize: (args) => {
    const parsed = numberOf(args.value);
    if (Number.isNaN(parsed))
      throw new ExpressionError("value must be a number");
    const category = new Intl.PluralRules(locale()).select(parsed);
    const exact = parsed === 0 ? args.zero : undefined;
    const chosen = exact ?? args[category] ?? args.other;
    return text(chosen);
  },
  and: ({ values }) => {
    if (!Array.isArray(values))
      throw new ExpressionError("values must be a list");
    return values.every(truthOf);
  },
  or: ({ values }) => {
    if (!Array.isArray(values))
      throw new ExpressionError("values must be a list");
    return values.some(truthOf);
  },
  not: ({ value }) => !truthOf(value),
  openUrl: ({ url }) => {
    openUrlSafely(url);
    return undefined;
  },
};

/** True when the basic function `name` must run from a user gesture. */
export function requiresUserActivation(name: string) {
  return A2UI_BASIC_FUNCTIONS[name]?.requiresUserActivation === true;
}

/** True when a basic function gives a ValidationResult. */
export function givesValidationResult(name: string) {
  return A2UI_BASIC_FUNCTIONS[name]?.returnType === "validationResult";
}
