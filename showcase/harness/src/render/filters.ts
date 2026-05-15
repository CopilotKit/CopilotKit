import { logger } from "../logger.js";

const ANSI_REGEX = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

// Conservative default used when an author supplies a malformed numeric
// argument at runtime. Keeps payloads safely under the Slack body ceiling
// without making the bug invisible — we still log a warning.
const DEFAULT_TRUNCATE_UTF8_BYTES = 2000;
const DEFAULT_TRUNCATE_CSV_CHARS = 500;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_REGEX, "");
}

/**
 * Truncate a string to at most `budget` bytes in UTF-8, splitting on a codepoint
 * boundary (never mid-codepoint) so the output is always valid UTF-8.
 */
export function truncateUtf8(input: string, budget: number): string {
  if (budget <= 0) return "";
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.length <= budget) return input;
  // Walk codepoints, accumulating byte lengths until we'd exceed budget.
  let out = "";
  let used = 0;
  for (const ch of input) {
    const chBytes = encoder.encode(ch).length;
    if (used + chBytes > budget) break;
    out += ch;
    used += chBytes;
  }
  return out;
}

/**
 * CSV-truncate: join a list of strings with ", ", clip to `budget` chars,
 * add "..." on overflow. null/undefined coerce to "" (not "null"/"undefined")
 * so missing fields render as empty rather than the literal word. Inputs
 * that aren't arrays collapse to a single-element list via String().
 *
 * Budget clamp: if budget < 3 we can't fit "...", so the suffix is trimmed
 * to the available budget (cap at 0 for negative values) instead of emitting
 * a longer-than-budget output.
 */
export function truncateCsv(input: unknown, budget: number): string {
  // Coerce null/undefined to empty — without this, the inner `String(input)`
  // would produce the literal strings "null"/"undefined" and leak them
  // into Slack messages where a template references a missing field.
  if (input == null) return "";
  const arr = Array.isArray(input)
    ? input.map((v) => (v == null ? "" : String(v)))
    : [String(input)];
  const joined = arr.join(", ");
  if (joined.length <= budget) return joined;
  // Cap the ellipsis itself when the budget is tiny/negative — otherwise
  // `joined.slice(0, 0) + "..."` emits a 3-char string even when budget
  // is 2, 1, 0, or negative.
  const clamped = Math.max(0, budget);
  const suffix = "...".slice(0, clamped);
  return joined.slice(0, Math.max(0, clamped - suffix.length)) + suffix;
}

/**
 * Single source of truth for filter names surfaced by the renderer pipeline.
 * `FilterName` is derived from this tuple, and `rule-loader.ts` imports
 * FILTER_NAMES to build its `KNOWN_FILTERS` validation set. Adding a new
 * filter requires appending to this tuple AND adding a `case` in
 * `applyPipeline` below — the type system enforces the latter (a missing
 * case fails the FilterName switch exhaustiveness) so drift between
 * declared-names and handled-names is compile-time caught, and drift
 * between renderer-known and loader-validated names is structurally
 * impossible.
 */
export const FILTER_NAMES = [
  "stripAnsi",
  "truncateUtf8",
  "truncateCsv",
  "slackEscape",
] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

/**
 * Basic Slack-safe escaping. Slack's reserved characters in mrkdwn text are
 * `&`, `<`, `>`; we escape those but leave `*`, `_`, `~` alone (authors use
 * them deliberately for formatting).
 *
 * IMPORTANT: this filter is NOT applied by default. Template authors must
 * explicitly pipe through `slackEscape` for any field that may originate
 * from user-controlled / third-party sources (probe payloads, CI output,
 * webhook bodies). Fields considered trust-by-default in our signal space
 * are `rule.*`, `event.*`, and `env.*`. Anything under `signal.*` should be
 * treated as untrusted unless you control the upstream producer.
 */
export function slackEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseBudget(
  raw: string | undefined,
  fallback: number,
  filter: string,
): number {
  if (raw == null) {
    logger.warn("filter: missing numeric argument, applying default", {
      filter,
      default: fallback,
    });
    return fallback;
  }
  const n = Number(raw);
  // Zero is rejected alongside negatives: `truncateUtf8(x, 0)` emits "" which
  // silently zeroes out real content. The prior comment said "don't silently
  // zero out" but the guard only caught negatives. Now 0 also falls back to
  // the conservative default with a warn log.
  if (!Number.isFinite(n) || Number.isNaN(n) || n <= 0) {
    logger.warn("filter: malformed numeric argument, applying default", {
      filter,
      raw,
      default: fallback,
    });
    return fallback;
  }
  return n;
}

/**
 * Apply a filter pipeline described as a single string like
 * `stripAnsi | truncateUtf8 200`. Each stage transforms the running value.
 *
 * Error handling:
 *   - Unknown filter names log a warning and pass the value through
 *     unchanged. This keeps the renderer from crashing on typos or on
 *     filters that were renamed/removed — degraded output is always better
 *     than a missing alert.
 *   - Malformed numeric arguments (NaN, negative, missing) log a warning
 *     and fall back to a conservative default rather than silently zeroing
 *     out (which would drop the value entirely) or uncapping (which would
 *     blow past the Slack body limit).
 */
export function applyPipeline(value: unknown, pipeline: string[]): string {
  // Coerce null/undefined to "" at the entry point. The previous
  // `String(current)` at the default branch and at the final return
  // produced the literal strings "null" / "undefined" when a template
  // referenced a missing path — surfacing the word "undefined" in
  // user-facing Slack alerts. Empty string is the right degraded value.
  let current: unknown = value == null ? "" : value;
  for (const stage of pipeline) {
    const parts = stage.trim().split(/\s+/);
    const name = parts[0] as FilterName;
    const args = parts.slice(1);
    switch (name) {
      case "stripAnsi":
        current = stripAnsi(String(current));
        break;
      case "truncateUtf8": {
        const n = parseBudget(
          args[0],
          DEFAULT_TRUNCATE_UTF8_BYTES,
          "truncateUtf8",
        );
        current = truncateUtf8(String(current), n);
        break;
      }
      case "truncateCsv": {
        const n = parseBudget(
          args[0],
          DEFAULT_TRUNCATE_CSV_CHARS,
          "truncateCsv",
        );
        current = truncateCsv(current, n);
        break;
      }
      case "slackEscape":
        current = slackEscape(String(current));
        break;
      default:
        logger.warn("filter: unknown filter, passing through unchanged", {
          filter: name,
        });
        // Do NOT coerce to String here — the next stage (if any) may be able
        // to handle the original type (e.g. an array for truncateCsv).
        break;
    }
  }
  // Final coercion: null/undefined should never surface as the literal
  // strings "null"/"undefined" in rendered output.
  if (current == null) return "";
  return String(current);
}
