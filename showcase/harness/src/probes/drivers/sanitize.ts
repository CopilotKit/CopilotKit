/**
 * Sanitization of probe `errorDesc` strings before they land in Slack
 * mrkdwn via Mustache triple-brace templating.
 *
 * Attacker-controlled HTTP response bodies (and even error messages from
 * our own stack) can contain HTML, Slack mrkdwn control tokens, and
 * backticks that would re-parse as formatting, @-mentions, or
 * `<!channel>` broadcasts once rendered. We strip all of that before it
 * reaches the template.
 *
 * Output guarantees:
 *   - no HTML tags (including `<script>` / `<style>` *bodies*)
 *   - no entity-smuggled tags (entities are decoded FIRST so a payload
 *     like `&lt;script&gt;…&lt;/script&gt;` is caught by the subsequent
 *     tag-body strip, not passed through as visible text)
 *   - no Slack mrkdwn control tokens (`<!channel>`, `<!here>`,
 *     `<!subteam^…>`, `<@U…>`)
 *   - no backticks
 *   - whitespace collapsed; trimmed; capped with `…` (U+2026)
 */

/** Common named HTML entities we decode. Extend only if probes start
 * emitting new ones — we deliberately keep this tight to avoid surprise. */
const ENTITY_MAP: Array<[RegExp, string]> = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

/** `<script>...</script>` / `<style>...</style>` including the body. Run
 * AFTER entity decode so entity-smuggled payloads are caught. */
const SCRIPT_STYLE_BODY_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Slack mrkdwn control tokens of the form `<!channel>`, `<!here>`,
 * `<!subteam^…>`, etc. */
const MRKDWN_BANG_RE = /<![a-z][^>]*>/gi;

/** Slack user-mention tokens `<@U…>`. */
const MRKDWN_USER_RE = /<@[A-Z0-9]+>/g;

/** Generic HTML open/close tags — replaced with a space so adjacent text
 * doesn't fuse. */
const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi;

/** Any remaining angle bracket — neutralized so Slack can't reparse as
 * a link or mrkdwn control sequence. */
const ANGLE_BRACKET_RE = /[<>]/g;

/** Slack mrkdwn code-span delimiter. */
const BACKTICK_RE = /`/g;

/** Collapse all runs of whitespace to a single ASCII space. */
const WHITESPACE_RE = /\s+/g;

export const ERROR_DESC_DEFAULT_MAX = 120;

/**
 * Sanitize an error description for safe injection into Slack mrkdwn via
 * Mustache triple-brace (`{{{…}}}`) templating.
 *
 * **Ordering is load-bearing** and must be preserved across refactors:
 *   1. decode HTML entities
 *   2. strip `<script>` / `<style>` bodies
 *   3. strip Slack mrkdwn control tokens
 *   4. strip remaining HTML tags
 *   5. neutralize leftover angle brackets
 *   6. strip backticks
 *   7. collapse whitespace
 *   8. cap length with U+2026 ellipsis
 *
 * The `strips_entity_encoded_script_tags` test in `sanitize.test.ts` is
 * the contract for this ordering — if a refactor reorders these steps
 * and that test stays green, the refactor is correct; if it goes red,
 * the refactor broke the invariant.
 */
export function sanitizeErrorDesc(
  raw: string,
  maxLen: number = ERROR_DESC_DEFAULT_MAX,
): string {
  if (!raw) return "";
  // 1. Decode common HTML entities FIRST so entity-encoded payloads
  //    surface as real tags for the subsequent strip steps.
  let s = raw;
  for (const [re, replacement] of ENTITY_MAP) {
    s = s.replace(re, replacement);
  }
  // 2. Strip <script>/<style> bodies outright (AFTER decode to catch
  //    entity-smuggled payloads).
  s = s.replace(SCRIPT_STYLE_BODY_RE, "");
  // 3. Strip Slack mrkdwn control tokens.
  s = s.replace(MRKDWN_BANG_RE, "").replace(MRKDWN_USER_RE, "");
  // 4. Strip remaining HTML tags (replace with space to avoid fusing
  //    adjacent text).
  s = s.replace(HTML_TAG_RE, " ");
  // 5. Neutralize leftover angle brackets so Slack can't reparse.
  s = s.replace(ANGLE_BRACKET_RE, " ");
  // 6. Strip backticks (Slack mrkdwn code spans).
  s = s.replace(BACKTICK_RE, "");
  // 7. Collapse whitespace.
  s = s.replace(WHITESPACE_RE, " ").trim();
  // 8. Cap with ellipsis (U+2026, single char).
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s;
}
