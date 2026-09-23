/**
 * Bounded, redacted error text for operator logs.
 *
 * Delivery failures used to be logged as a fixed category only, which left a
 * developer with "unknown" and no cause. This keeps an error's own message
 * but strips anything that looks like a credential and caps its length, so it
 * is safe to put in a log line. Callers pass the message string only; stacks,
 * causes, and payloads never reach this function.
 */

/** Maximum length of the returned message, including the ellipsis. */
export const SAFE_ERROR_MESSAGE_MAX_LENGTH = 300;

/**
 * Safety cap on the text the patterns scan, bounding regex cost only. It is
 * far above the output length, so redaction always sees whole secrets before
 * the result is truncated.
 */
const MAX_SCANNED_LENGTH = 65_536;

const REDACTED = "[redacted]";

// Specific credential shapes, applied in order.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // URL userinfo, with or without a password (`user:pass@`, `token@`). The
  // run is greedy up to the last `@` before the host, so an `@` inside the
  // password cannot leak its tail.
  [/\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#"'<>]{1,1024}@/gi, `$1${REDACTED}@`],
  // Authorization header values, in any case (`Bearer`, `basic`, `BASIC`).
  [/\b(bearer|basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`],
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-, xoxe-, xapp-).
  [/\bxox[abeoprs]-[A-Za-z0-9-]+/g, REDACTED],
  [/\bxapp-[A-Za-z0-9-]+/g, REDACTED],
  // Provider API keys (`sk-…`, `sk-ant-…`, CopilotKit `cpk-…`).
  [/\b(?:sk|cpk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  // JWTs. The lookbehind allows one start per token run, so a long run of
  // `eyJ-eyJ-…` without dots is scanned once instead of once per `eyJ`.
  [
    /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
    REDACTED,
  ],
];

// `token=…`, `api_key: …`, `"password": "…"` and similar key/value pairs.
// A quoted value runs through its closing quote, skipping escaped quotes
// (`"abc\"def ghi"` goes whole); an unclosed quote runs to the end of the line
// or text. An unquoted value runs up to whitespace or a delimiter.
const SECRET_KEY_VALUE =
  /((?:token|secret|password|passwd|api[_-]?key|apikey|authorization|signature|credential)s?["']?\s*[:=]\s*)(?:(")(?:\\.|[^"\\\n])*(")?|(')(?:\\.|[^'\\\n])*(')?|[^\s,;&"'}]+)/gi;

function redactKeyValue(
  _match: string,
  prefix: string,
  doubleOpen: string | undefined,
  doubleClose: string | undefined,
  singleOpen: string | undefined,
  singleClose: string | undefined,
): string {
  const open = doubleOpen ?? singleOpen ?? "";
  const close = doubleClose ?? singleClose ?? "";
  return `${prefix}${open}${REDACTED}${close}`;
}

// Any other long opaque run (hex secrets, base64 keys, signed ids). Only runs
// that mix letters and digits are redacted, so long plain words survive. `/`
// is not part of a run, so each path segment is judged on its own.
// Over-redacting an id is an acceptable cost.
const LONG_OPAQUE_RUN = /[A-Za-z0-9_+=-]{32,}/g;

/** Replace secret-looking substrings in `text` with `[redacted]`. */
export function redactSecretLikeValues(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  result = result.replace(SECRET_KEY_VALUE, redactKeyValue);
  return result.replace(LONG_OPAQUE_RUN, (match) =>
    /[A-Za-z]/.test(match) && /[0-9]/.test(match) ? REDACTED : match,
  );
}

/** Cut `text` to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const lastKept = text.charCodeAt(cut - 1);
  if (lastKept >= 0xd800 && lastKept <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * `message`, redacted, single-line, and at most
 * {@link SAFE_ERROR_MESSAGE_MAX_LENGTH} characters. Redaction runs before
 * newlines are collapsed (so an unclosed quoted secret stops at its line) and
 * before truncation (so a cut cannot shorten a secret below a pattern's
 * minimum). Returns `undefined` when there is nothing to report.
 */
export function safeErrorMessage(message: string): string | undefined {
  if (!message) return undefined;
  const singleLine = redactSecretLikeValues(
    message.slice(0, MAX_SCANNED_LENGTH),
  )
    // Control characters and newlines could forge extra log lines.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return undefined;
  return truncate(singleLine, SAFE_ERROR_MESSAGE_MAX_LENGTH);
}
