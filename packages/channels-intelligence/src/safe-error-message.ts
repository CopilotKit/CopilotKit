/**
 * Bounded, redacted error text for operator logs.
 *
 * Delivery failures used to be logged as a fixed category only, which left a
 * developer with "unknown" and no cause. This keeps the error's own message
 * but strips anything that looks like a credential and caps its length, so it
 * is safe to put in a log line. It never includes stacks, causes, or payloads.
 */

/** Maximum length of the returned message, including the ellipsis. */
export const SAFE_ERROR_MESSAGE_MAX_LENGTH = 300;

/** Input is capped before redaction so the regexes run on bounded text. */
const MAX_SCANNED_LENGTH = 4_000;

const REDACTED = "[redacted]";

// Specific credential shapes, applied in order.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `scheme://user:password@host` — drop the credentials, keep the host.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Authorization header values, in any case (`Bearer`, `basic`, `BASIC`).
  [/\b(bearer|basic)\s+[^\s,;"']+/gi, `$1 ${REDACTED}`],
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxr-, xoxs-, xoxe-, xapp-).
  [/\bxox[abeoprs]-[A-Za-z0-9-]+/g, REDACTED],
  [/\bxapp-[A-Za-z0-9-]+/g, REDACTED],
  // Provider API keys (`sk-…`, `sk-ant-…`, CopilotKit `cpk-…`).
  [/\b(?:sk|cpk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED],
];

// `token=…`, `api_key: …`, `"password": "…"` and similar key/value pairs. A
// quoted value is redacted through its closing quote (so `"open sesame"` goes
// whole); an unquoted value runs up to whitespace or a delimiter.
const SECRET_KEY_VALUE =
  /\b([\w-]*(?:token|secret|password|passwd|api[_-]?key|apikey|authorization|signature|credential)s?["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|(["']?)[^\s,;&"'}]+)/gi;

function redactKeyValue(
  match: string,
  prefix: string,
  unquotedLead: string | undefined,
): string {
  const value = match.slice(prefix.length);
  if (unquotedLead === undefined) {
    const quote = value[0]!;
    return `${prefix}${quote}${REDACTED}${quote}`;
  }
  return `${prefix}${unquotedLead}${REDACTED}`;
}

// Any other long opaque run (hex secrets, base64 keys, signed ids). Only runs
// that mix letters and digits are redacted, so long plain words survive.
// Over-redacting an id is an acceptable cost.
const LONG_OPAQUE_RUN = /[A-Za-z0-9_+/=-]{32,}/g;

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

/**
 * The error's own message, single-line, redacted, and at most
 * {@link SAFE_ERROR_MESSAGE_MAX_LENGTH} characters. Returns `undefined` when
 * there is no message to report.
 */
export function safeErrorMessage(error: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof error === "string") {
    raw = error;
  } else if (error instanceof Error) {
    raw = error.message;
  } else if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    raw = (error as { message: string }).message;
  }
  if (!raw) return undefined;

  const singleLine = raw
    .slice(0, MAX_SCANNED_LENGTH)
    // Control characters and newlines could forge extra log lines.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return undefined;

  const redacted = redactSecretLikeValues(singleLine);
  if (redacted.length <= SAFE_ERROR_MESSAGE_MAX_LENGTH) return redacted;
  return `${redacted.slice(0, SAFE_ERROR_MESSAGE_MAX_LENGTH - 1)}…`;
}
