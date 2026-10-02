import { REDACTED } from "./types";

// Passwords and unambiguous credentials never leave the browser, even with full
// capture. Keys match lowercase without `_`, `-`, `.`, `+`, spaces, or percent
// escapes, so `access_token`, `Access-Token`, and `accessToken` all match.
// `secret` also covers `clientsecret`. Broad words such as `name` or `id` stay raw.
const CREDENTIAL_KEY =
  /password|passwd|passphrase|passcode|secret|apikey|accesstoken|refreshtoken|idtoken|authtoken|sessiontoken|privatekey|credential|^(pwd|pass|token|otp)$/;
const PASSWORD_AUTOCOMPLETE = /(current|new)-password|one-time-code/;
// Fallback for text that is not valid JSON, such as a cut-off snapshot. An
// unterminated value runs to the end, so a cut can never expose its prefix.
const JSON_PAIR =
  /"((?:\\.|[^"\\])*)"(\s*:\s*)(?:"(?:\\.|[^"\\])*"?|[^\s,}\]]*)/g;
// The key length bound keeps scanning long unbroken text linear.
const FORM_PAIR = /([^\s"&=?#]{1,64})=[^\s"&]*/g;
// Bounds the work on large bodies; snapshots keep only 4 KiB of the result.
const TEXT_LIMIT = 16 * 1024;
const REMEMBERED_VALUES = 20;

export const isCredentialKey = (key: string) =>
  CREDENTIAL_KEY.test(key.toLowerCase().replace(/%[\da-f]{2}|[-_. +]/g, ""));

const redactPairs = (text: string) =>
  text
    .replace(JSON_PAIR, (pair, key: string, separator: string) =>
      isCredentialKey(key) ? `"${key}"${separator}"${REDACTED}"` : pair,
    )
    .replace(FORM_PAIR, (pair, key: string) =>
      isCredentialKey(key) ? `${key}=${REDACTED}` : pair,
    );

/** Per-session redaction state: password-like fields and the values typed into them. */
export function createRedactor() {
  const seen = new WeakSet<Element>();
  // Latest value per field, so each keystroke replaces the previous prefix.
  const remembered = new Map<Element, string>();

  /** Replaces remembered values, raw and in their JSON and URL encodings. */
  const scrub = (text: string) => {
    for (const value of [...remembered.values()].sort(
      (a, b) => b.length - a.length,
    ))
      for (const form of [
        value,
        JSON.stringify(value).slice(1, -1),
        encodeURIComponent(value),
        new URLSearchParams({ v: value }).toString().slice(2),
      ])
        text = text.split(form).join(REDACTED);
    return text;
  };

  return {
    /** True for current, former (show-password toggles), and autocomplete password fields. */
    isPassword(element: Element) {
      if (
        !(element instanceof HTMLInputElement) ||
        !(
          element.type === "password" ||
          seen.has(element) ||
          isCredentialKey(element.name) ||
          PASSWORD_AUTOCOMPLETE.test(element.getAttribute("autocomplete") ?? "")
        )
      )
        return false;
      seen.add(element);
      if (element.value.length >= 4) {
        remembered.delete(element);
        remembered.set(element, element.value);
        if (remembered.size > REMEMBERED_VALUES)
          remembered.delete(remembered.keys().next().value!);
      }
      return true;
    },
    field: (key: string, value: string) =>
      isCredentialKey(key) ? REDACTED : scrub(value),
    /** Returns the redacted body text, or undefined if redaction failed. */
    body(text: string) {
      try {
        text = text.slice(0, TEXT_LIMIT);
        let hit = false;
        const walk = (value: unknown, key?: string): unknown => {
          if (key !== undefined && isCredentialKey(key)) {
            hit = true;
            return REDACTED;
          }
          if (Array.isArray(value)) return value.map((item) => walk(item));
          if (value !== null && typeof value === "object")
            return Object.fromEntries(
              Object.entries(value).map(([name, item]) => [
                name,
                walk(item, name),
              ]),
            );
          return value;
        };
        let json: string | undefined;
        try {
          json = JSON.stringify(walk(JSON.parse(text)));
        } catch {
          /* Not JSON, or cut off: use the pair fallback. */
        }
        // Unchanged JSON keeps its original formatting.
        return scrub(
          json === undefined ? redactPairs(text) : hit ? json : text,
        );
      } catch {
        return undefined;
      }
    },
    /** Drops userinfo and redacts credential values in the query and hash. */
    url(value: string) {
      if (!value) return value;
      try {
        const url = new URL(value);
        url.username = url.password = "";
        url.search = redactPairs(url.search);
        url.hash = redactPairs(url.hash);
        return scrub(url.href);
      } catch {
        return REDACTED;
      }
    },
  };
}

export type Redactor = ReturnType<typeof createRedactor>;
