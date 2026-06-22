import type { RedactionConfig } from "./types";

/**
 * Built-in sensitive key names, matched case-insensitively. Customer-supplied
 * keys are merged on top of this list; it is never replaced, so opting in to
 * extra keys can only ever redact more, never less.
 */
export const BUILT_IN_SENSITIVE_KEYS: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "ssn",
  "pin",
  "otp",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
];

/** Default mask substituted for a redacted value. */
export const DEFAULT_MASK = "***";

/** Normalized redaction settings used by {@link redactValue} / {@link redactUrlQuery}. */
export interface ResolvedRedaction {
  /** Lower-cased sensitive key names. */
  keys: Set<string>;
  /** Mask string, or `null` to remove matched keys entirely. */
  replaceWith: string | null;
}

/**
 * Merge the built-in deny list with any customer keys and resolve the
 * replacement strategy. Defaults to masking with {@link DEFAULT_MASK}.
 */
export function resolveRedaction(config?: RedactionConfig): ResolvedRedaction {
  const keys = new Set(BUILT_IN_SENSITIVE_KEYS);
  for (const key of config?.keys ?? []) {
    keys.add(key.toLowerCase());
  }
  const replaceWith =
    config?.replaceWith === undefined ? DEFAULT_MASK : config.replaceWith;
  return { keys, replaceWith };
}

const isSensitiveKey = (key: string, redaction: ResolvedRedaction): boolean =>
  redaction.keys.has(key.toLowerCase());

/**
 * Deeply redact sensitive keys in a JSON-like value, returning a new value
 * (the input is never mutated). Objects and arrays are walked recursively;
 * matched keys are masked or dropped per {@link ResolvedRedaction.replaceWith}.
 * Primitives pass through unchanged.
 */
export function redactValue(
  value: unknown,
  redaction: ResolvedRedaction,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redaction));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key, redaction)) {
        if (redaction.replaceWith !== null) {
          out[key] = redaction.replaceWith;
        }
        // replaceWith === null → drop the key entirely.
      } else {
        out[key] = redactValue(item, redaction);
      }
    }
    return out;
  }
  return value;
}

/**
 * Redact sensitive query-string parameters in an absolute URL. Returns the URL
 * unchanged if it cannot be parsed (defensive — capture must never throw).
 */
export function redactUrlQuery(
  url: string,
  redaction: ResolvedRedaction,
): string {
  try {
    const parsed = new URL(url);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (!isSensitiveKey(key, redaction)) continue;
      if (redaction.replaceWith !== null) {
        parsed.searchParams.set(key, redaction.replaceWith);
      } else {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
