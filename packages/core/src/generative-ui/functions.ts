import {
  GENERATIVE_UI_FUNCTIONS,
  isValidationResult,
} from "@copilotkit/shared";
import type { A2UIValidationResult } from "@copilotkit/shared";

// The renderer-side functions of the A2UI 1.0 basic catalog, and the
// CopilotKit value functions. Each one takes resolved args (no bindings
// left in them) and gives a plain value. They run synchronously, so a prop
// bound to one updates in the same render as the data it reads. The
// signatures the model sees are in `@copilotkit/shared`
// (`GENERATIVE_UI_FUNCTIONS`: `A2UI_BASIC_FUNCTIONS` and
// `COPILOTKIT_FUNCTIONS`). They also run on React Native (Hermes), so a
// global that Hermes lacks is used only behind a feature check.

/** Thrown for a bad call: an unknown function, bad args, or a bad value. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

/**
 * Thrown when the platform lacks what a function needs: `window.open`, or
 * an `Intl` constructor on a Hermes build. The call itself was fine, so it
 * is not an ExpressionError: the dispatcher reports it as `handler_failed`,
 * not `invalid_arguments`, and the model is not told to change its args.
 */
export class PlatformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformError";
  }
}

export type BasicFunction = (args: Record<string, unknown>) => unknown;

/** The boolean of a DynamicBoolean: a ValidationResult counts as `valid`. */
export function truthOf(value: unknown): boolean {
  if (isValidationResult(value)) return value.valid;
  return Boolean(value);
}

const valid = (): A2UIValidationResult => ({ valid: true });
/** A failed result. `code` names the failure, the same for every locale. */
const invalid = (message: string, code: string): A2UIValidationResult => ({
  valid: false,
  message,
  code,
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

type IntlName = "NumberFormat" | "DateTimeFormat" | "PluralRules";

/**
 * The `Intl` constructor `name`, or `undefined` when the platform lacks it.
 * Read as an optional member: Hermes has no PluralRules, and a Hermes build
 * without Intl has no `Intl` at all.
 */
function intlConstructor<T>(name: IntlName): T | undefined {
  const intl =
    typeof Intl === "undefined"
      ? undefined
      : (Intl as unknown as Record<string, unknown>);
  const value = intl?.[name];
  return typeof value === "function" ? (value as T) : undefined;
}

/** The `Intl` constructor `name`, or a PlatformError that says so. */
function requireIntl<T>(name: IntlName, caller: string): T {
  const constructor = intlConstructor<T>(name);
  if (constructor === undefined) {
    throw new PlatformError(
      `${caller} needs Intl.${name}, which this platform does not have`,
    );
  }
  return constructor;
}

function numberFormat(
  caller: string,
  args: Record<string, unknown>,
  options: Intl.NumberFormatOptions,
) {
  const NumberFormat = requireIntl<typeof Intl.NumberFormat>(
    "NumberFormat",
    caller,
  );
  const decimals = optionalNumber(args.decimals, "decimals");
  return new NumberFormat(locale(), {
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
 * A TR35 field is a run of one letter ("EEE" is one abbreviated weekday,
 * not three), and text in single quotes is literal. Letters that are not
 * fields stay as they are.
 */
const DATE_FIELD = /([A-Za-z])\1*|'(?:[^']|'')*'/g;

function formatDatePattern(date: Date, pattern: string) {
  // Only the text fields (month and weekday names) need Intl.
  const parts = (options: Intl.DateTimeFormatOptions) => {
    const DateTimeFormat = requireIntl<typeof Intl.DateTimeFormat>(
      "DateTimeFormat",
      "formatDate",
    );
    return new DateTimeFormat(locale(), options).format(date);
  };
  const hours12 = date.getHours() % 12 || 12;
  const numeric = (value: number, width: number) =>
    width >= 2 ? pad(value, 2) : String(value);
  return pattern.replace(DATE_FIELD, (token) => {
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
    const width = token.length;
    switch (token[0]) {
      case "y":
        return width === 2
          ? pad(date.getFullYear() % 100, 2)
          : String(date.getFullYear());
      case "M":
        if (width >= 4) return parts({ month: "long" });
        if (width === 3) return parts({ month: "short" });
        return numeric(date.getMonth() + 1, width);
      case "d":
        return numeric(date.getDate(), width);
      case "E":
        return parts({ weekday: width >= 4 ? "long" : "short" });
      case "H":
        return numeric(date.getHours(), width);
      case "h":
        return numeric(hours12, width);
      case "m":
        return pad(date.getMinutes(), 2);
      case "s":
        return pad(date.getSeconds(), 2);
      case "a":
        return date.getHours() < 12 ? "AM" : "PM";
      default:
        return token;
    }
  });
}

/**
 * The plural category of `value`. Hermes has no `Intl.PluralRules`, so
 * there the English rule decides: "one" for 1 and -1, else "other".
 */
function pluralCategory(value: number): string {
  const PluralRules =
    intlConstructor<new (locale?: string) => { select(value: number): string }>(
      "PluralRules",
    );
  if (PluralRules !== undefined) {
    return new PluralRules(locale()).select(value);
  }
  return value === 1 || value === -1 ? "one" : "other";
}

/** An http(s) URL, or why a string is not one. */
type ParsedUrl =
  | { kind: "web"; hostname: string; href: string }
  | { kind: "relative" }
  | { kind: "other"; protocol: string }
  | { kind: "invalid" };

const SCHEME = /^([A-Za-z][A-Za-z\d+\-.]*):/;
/** True for a C0 control or DEL (`spaces` also counts a space as one). */
function isControl(code: number, spaces = false) {
  return code < 0x20 || code === 0x7f || (spaces && code === 0x20);
}

/** WHATWG URL ignores leading and trailing C0 controls and spaces. */
function trimControls(input: string) {
  let start = 0;
  let end = input.length;
  while (start < end && isControl(input.charCodeAt(start), true)) start += 1;
  while (end > start && isControl(input.charCodeAt(end - 1), true)) end -= 1;
  return input.slice(start, end);
}

function hasControl(input: string) {
  for (let index = 0; index < input.length; index += 1) {
    if (isControl(input.charCodeAt(index))) return true;
  }
  return false;
}

/** A host name: no empty label, no forbidden host code point. */
const HOSTNAME = /^[^\s#%/:<>?@[\\\]^|.]+(?:\.[^\s#%/:<>?@[\\\]^|.]+)*\.?$/;

/** A dotted-decimal IPv4 address inside an IPv6 literal, as WHATWG takes it. */
const EMBEDDED_IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_PIECE = /^[\da-f]{1,4}$/i;

/** The colon-separated pieces of one side of an IPv6 `::`. */
function ipv6Pieces(half: string) {
  return half === "" ? [] : half.split(":");
}

/**
 * Is `literal` (the inside of `[...]`) an IPv6 address? Eight pieces of one
 * to four hex digits, or fewer with one `::` that stands for at least one
 * zero piece; the last two pieces may be a dotted IPv4 address. No zone.
 */
function isIpv6(literal: string) {
  const halves = literal.split("::");
  if (halves.length > 2) return false;
  const head = ipv6Pieces(halves[0]!);
  const tail = halves.length === 2 ? ipv6Pieces(halves[1]!) : [];
  const pieces = [...head, ...tail];
  // Only the last piece of the whole literal may be an IPv4 address.
  const lastCanBeIpv4 = halves.length === 1 || tail.length > 0;
  let count = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]!;
    if (IPV6_PIECE.test(piece)) {
      count += 1;
    } else if (
      lastCanBeIpv4 &&
      index === pieces.length - 1 &&
      EMBEDDED_IPV4.test(piece)
    ) {
      count += 2;
    } else {
      return false;
    }
  }
  return halves.length === 2 ? count < 8 : count === 8;
}

/** A WHATWG IPv4 number: decimal, `0x` hex or `0` octal, or undefined. */
function ipv4Number(part: string): number | undefined {
  if (/^0x[\da-f]*$/i.test(part)) {
    return part.length === 2 ? 0 : parseInt(part.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(part)) return parseInt(part.slice(1), 8);
  if (/^(?:0|[1-9]\d*)$/.test(part)) return Number(part);
  return undefined;
}

/**
 * A host name whose last label is a number is an IPv4 address to WHATWG
 * URL: up to four parts, each decimal, hex or octal, every part but the last
 * at most 255 and the last filling the rest of the 32 bits. Returns the
 * host in dotted decimal, the host itself when it does not end in a number,
 * or undefined when it is not a valid address.
 */
function ipv4Host(hostname: string): string | undefined {
  const parts = hostname.split(".");
  if (parts[parts.length - 1] === "" && parts.length > 1) parts.pop();
  const last = parts[parts.length - 1]!;
  if (!/^\d+$/.test(last) && ipv4Number(last) === undefined) return hostname;
  if (parts.length > 4) return undefined;
  const numbers = parts.map(ipv4Number);
  if (numbers.some((number) => number === undefined)) return undefined;
  const values = numbers as number[];
  const lastValue = values.pop()!;
  if (values.some((value) => value > 255)) return undefined;
  if (lastValue >= 256 ** (4 - values.length)) return undefined;
  let address = lastValue;
  values.forEach((value, index) => {
    address += value * 256 ** (3 - index);
  });
  const octets = [24, 16, 8, 0].map(
    (shift) => Math.floor(address / 2 ** shift) % 256,
  );
  return octets.join(".");
}

/** The host of an http(s) URL, normalized, or undefined when invalid. */
function checkHost(hostname: string): string | undefined {
  if (hostname.startsWith("[")) {
    return hostname.endsWith("]") && isIpv6(hostname.slice(1, -1))
      ? hostname
      : undefined;
  }
  return HOSTNAME.test(hostname) ? ipv4Host(hostname) : undefined;
}

/**
 * Parses an absolute http(s) URL with no help from the `URL` global. React
 * Native has its own URL class (Libraries/Blob/URL.js): its constructor
 * never throws without a base, its `protocol` keeps the case of the input,
 * and before 0.80 its getters throw "not implemented". The scheme is
 * matched in any case, and an http(s) URL needs "//" and a host.
 */
function parseUrl(input: string): ParsedUrl {
  const url = trimControls(input);
  const scheme = SCHEME.exec(url);
  if (scheme === null) return { kind: "relative" };
  const protocol = `${scheme[1]!.toLowerCase()}:`;
  if (protocol !== "http:" && protocol !== "https:") {
    return { kind: "other", protocol };
  }
  const rest = url.slice(scheme[0].length);
  if (!rest.startsWith("//") || hasControl(rest)) return { kind: "invalid" };
  const authorityEnd = rest.slice(2).search(/[/?#\\]/);
  const authority =
    authorityEnd < 0 ? rest.slice(2) : rest.slice(2, authorityEnd + 2);
  const tail = authorityEnd < 0 ? "" : rest.slice(authorityEnd + 2);
  // A backslash in the path is a slash to WHATWG but not to every opener.
  // WHATWG URL never leaves one there, so only a hand-written URL has it.
  if (/^[^?#]*\\/.test(tail)) return { kind: "invalid" };
  const at = authority.lastIndexOf("@");
  const userinfo = at < 0 ? "" : authority.slice(0, at + 1);
  const hostAndPort = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(
    authority.slice(at + 1),
  );
  if (hostAndPort === null) return { kind: "invalid" };
  const hostname = checkHost(hostAndPort[1]!.toLowerCase());
  const port = hostAndPort[2] ?? "";
  if (hostname === undefined || /\s/.test(userinfo) || Number(port) > 65535) {
    return { kind: "invalid" };
  }
  const path = tail.startsWith("/") ? tail : `/${tail}`;
  return {
    kind: "web",
    hostname,
    href: `${protocol}//${userinfo}${hostname}${port ? `:${port}` : ""}${path.replace(/ /g, "%20")}`,
  };
}

/** The host of a URL with an authority, lowercase, or "" without one. */
const PAGE_HOST =
  /^[A-Za-z][A-Za-z\d+\-.]*:\/\/(?:[^/?#@]*@)?(\[[^\]]*\]|[^/?#:]*)/;

/**
 * The URL of the page, to resolve a relative URL against. `undefined` when
 * there is no real page: on React Native (`navigator.product`), where any
 * `location` is a polyfill, such as "http://react-native.invalid" or the
 * Metro address; or a location whose host is reserved (`.invalid` is never
 * a real host, with or without the trailing dot). Any other location is a
 * browser page, whatever its scheme: WHATWG URL resolves against it, as it
 * did before React Native was supported.
 */
function pageBase(host: Partial<Window>): string | undefined {
  if (typeof navigator !== "undefined") {
    const product = (navigator as { product?: unknown }).product;
    if (product === "ReactNative") return undefined;
  }
  const href = host.location?.href; // hermes-ok: optional, checked below
  if (typeof href !== "string") return undefined;
  const pageHost = PAGE_HOST.exec(href.trim())?.[1] ?? "";
  const hostname = pageHost.toLowerCase().replace(/\.$/, "");
  const isReserved = hostname === "invalid" || hostname.endsWith(".invalid");
  return isReserved ? undefined : href;
}

/**
 * openUrl on a browser page, exactly as before React Native was supported:
 * WHATWG URL resolves `url` against the page, and any http(s) URL it
 * accepts opens, in its serialization.
 */
function openOnPage(
  host: Partial<Window>,
  open: Window["open"],
  url: string,
  base: string,
) {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    throw new ExpressionError(`"${url}" is not a URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ExpressionError(
      `openUrl takes only http(s) URLs, not ${parsed.protocol}`,
    );
  }
  open.call(host, parsed.href, "_blank", "noopener,noreferrer");
}

/**
 * Opens an http(s) URL in a new tab. Any other scheme is refused.
 *
 * Without a `window` (server rendering) it does nothing. A platform that has
 * a `window` but no `window.open` (React Native, where `window` is the global
 * object) gets a PlatformError, not a misleading URL-parsing one. On a
 * browser page WHATWG URL decides, as it always did. Without a real page
 * origin (React Native, also with the location polyfill) only absolute
 * URLs are taken: a relative one has nothing to resolve against. There the
 * URL is checked by the stricter `parseUrl`, not by React Native's URL
 * class, which accepts almost anything.
 */
export function openUrlSafely(url: unknown) {
  if (typeof url !== "string" || url === "") {
    throw new ExpressionError("url must be a string");
  }
  if (typeof window === "undefined") return;
  const host = window as Partial<Window>;
  const open = host.open;
  if (typeof open !== "function") {
    throw new PlatformError("openUrl is not available on this platform");
  }
  const base = pageBase(host);
  if (base !== undefined) {
    openOnPage(host, open, url, base);
    return;
  }
  const parsed = parseUrl(url);
  if (parsed.kind === "relative") {
    throw new ExpressionError(`"${url}" is not an absolute URL`);
  }
  if (parsed.kind === "other") {
    throw new ExpressionError(
      `openUrl takes only http(s) URLs, not ${parsed.protocol}`,
    );
  }
  if (parsed.kind === "invalid") {
    throw new ExpressionError(`"${url}" is not a URL`);
  }
  open.call(host, parsed.href, "_blank", "noopener,noreferrer");
}

/**
 * The basic functions, except `formatString`, `calc` and `series`:
 * `resolve.ts` adds those three when it loads (`formatString` needs the
 * resolver, and `calc.ts` uses this module). Import `resolve.ts` before
 * looking a function up here.
 */
export const BASIC_FUNCTIONS: Record<string, BasicFunction> = {
  required: ({ value }) => {
    const isEmpty =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    return isEmpty ? invalid("Required", "required") : valid();
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
    return expression.test(text(value))
      ? valid()
      : invalid("Invalid format", "pattern");
  },
  length: ({ value, min, max }) => {
    const size = text(value).length;
    const low = optionalNumber(min, "min");
    const high = optionalNumber(max, "max");
    if (low !== undefined && size < low)
      return invalid(`At least ${low} characters`, "tooShort");
    if (high !== undefined && size > high)
      return invalid(`At most ${high} characters`, "tooLong");
    return valid();
  },
  numeric: ({ value, min, max }) => {
    const parsed = numberOf(value);
    if (Number.isNaN(parsed)) return invalid("Must be a number", "notANumber");
    const low = optionalNumber(min, "min");
    const high = optionalNumber(max, "max");
    if (low !== undefined && parsed < low)
      return invalid(`At least ${low}`, "tooSmall");
    if (high !== undefined && parsed > high)
      return invalid(`At most ${high}`, "tooLarge");
    return valid();
  },
  email: ({ value }) =>
    EMAIL.test(text(value))
      ? valid()
      : invalid("Invalid email address", "email"),
  formatNumber: (args) => {
    const parsed = numberOf(args.value);
    if (Number.isNaN(parsed))
      throw new ExpressionError("value must be a number");
    return numberFormat("formatNumber", args, {}).format(parsed);
  },
  formatCurrency: (args) => {
    const parsed = numberOf(args.value);
    if (Number.isNaN(parsed))
      throw new ExpressionError("value must be a number");
    if (typeof args.currency !== "string" || args.currency === "") {
      throw new ExpressionError("currency must be an ISO 4217 code");
    }
    // Checked before the try, which reads every error as a bad currency.
    requireIntl("NumberFormat", "formatCurrency");
    try {
      return numberFormat("formatCurrency", args, {
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
    const category = pluralCategory(parsed);
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
  return GENERATIVE_UI_FUNCTIONS[name]?.requiresUserActivation === true;
}

/** True when a basic function gives a ValidationResult. */
export function givesValidationResult(name: string) {
  return GENERATIVE_UI_FUNCTIONS[name]?.returnType === "validationResult";
}
