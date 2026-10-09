let warned = false;

const MIGRATION_GUIDE_URL =
  "https://docs.copilotkit.ai/migrate/markdown-renderer#migrate-with-your-ai-assistant";

// A ``` or ~~~ fence immediately followed by a language token (e.g. ```ts).
// Plain fences with no language are not flagged — they render fine.
const HIGHLIGHTABLE_CODE = /(^|\n)[ \t]*(```|~~~)[ \t]*[A-Za-z][\w+#-]*/;
// Block math: $$ … $$ or \[ … \]. Inline `$…$` is intentionally not flagged
// (too many false positives with currency, e.g. "$5 and $10").
const BLOCK_MATH = /\$\$[\s\S]+?\$\$/;
const BRACKET_MATH = /\\\[[\s\S]+?\\\]/;

function isProduction(): boolean {
  return (
    typeof process !== "undefined" &&
    process.env != null &&
    process.env.NODE_ENV === "production"
  );
}

/**
 * Dev-only, once-per-session warning emitted when CopilotKit's built-in default
 * markdown renderer encounters markdown it won't render richly — math
 * (`$$…$$` / `\[…\]`) or a language-tagged fenced code block (rendered as plain,
 * un-highlighted code). Helps people upgrading from the bundled Streamdown
 * default notice the behavioral change and points them at the migration guide.
 *
 * No-op in production and after the first warning. Only the built-in default
 * renderers call this — a custom `markdownRenderer` never triggers it.
 *
 * @internal
 */
export function warnUnsupportedRichSyntaxOnce(content: string): void {
  if (warned || !content || isProduction()) return;

  const hasMath = BLOCK_MATH.test(content) || BRACKET_MATH.test(content);
  const hasHighlightableCode = HIGHLIGHTABLE_CODE.test(content);
  if (!hasMath && !hasHighlightableCode) return;

  warned = true;
  const [feature, missing] = hasMath
    ? ["math", "math typesetting"]
    : ["a syntax-highlighted code block", "syntax highlighting"];
  // eslint-disable-next-line no-console
  console.warn(
    `[CopilotKit] The built-in markdown renderer rendered ${feature} without ${missing}. ` +
      `It supports GFM, tables, autolinks, and citations, but not math, syntax ` +
      `highlighting, or diagrams. To restore those, plug in a custom markdownRenderer ` +
      `(e.g. react-markdown or streamdown) — or paste the migration prompt into your ` +
      `AI assistant: ${MIGRATION_GUIDE_URL}`,
  );
}

/**
 * Resets the once-guard. Test-only.
 * @internal
 */
export function __resetUnsupportedRichSyntaxWarning(): void {
  warned = false;
}
