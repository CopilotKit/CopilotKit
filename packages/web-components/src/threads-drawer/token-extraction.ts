/**
 * Pure CSS token-extraction helpers shared by the build-time token-sync script
 * (`scripts/generate-tokens.ts`) and the drift-guard test
 * (`__tests__/generated-tokens.test.ts`).
 *
 * These live in `src/` rather than in `scripts/` for two reasons: (1) the test
 * cannot import from `scripts/` without pulling a file outside the package's
 * tsc `rootDir` into the typecheck program, and (2) keeping a single canonical
 * parser means the build output and the drift guard can never diverge on how
 * the `[data-copilotkit]` block is located and parsed. The script imports these
 * from here; nothing in the shipped element does, so the bundler tree-shakes
 * them out of the published artifact.
 */

/**
 * Extracts the light-mode `[data-copilotkit] { ... }` declaration block from the
 * canonical globals.css using a brace-balanced scan.
 *
 * Taking the first `}` after the opening brace would silently truncate the block
 * if it ever contains a nested brace (a `@media`/nested rule, or a brace inside a
 * value), dropping later tokens. Counting depth finds the matching close brace —
 * the true end of the block — instead.
 *
 * @param css - Full globals.css source text.
 * @param sourceLabel - Human-readable source name surfaced in error messages.
 * @returns The block body between (but excluding) the outer braces.
 * @throws If the block cannot be located or its braces are unbalanced.
 */
export function extractLightThemeBlock(
  css: string,
  sourceLabel = "the canonical theme",
): string {
  const start = css.indexOf("[data-copilotkit] {");
  if (start === -1) {
    throw new Error(
      `[generate-tokens] Could not find "[data-copilotkit] {" in ${sourceLabel}`,
    );
  }
  const open = css.indexOf("{", start);
  if (open === -1) {
    throw new Error(
      `[generate-tokens] Malformed "[data-copilotkit]" block in ${sourceLabel}`,
    );
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < css.length; i++) {
    const char = css[i];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    throw new Error(
      `[generate-tokens] Unbalanced braces in "[data-copilotkit]" block in ${sourceLabel}`,
    );
  }
  return css.slice(open + 1, close);
}

/**
 * Parses `--name: value;` custom-property declarations from a CSS block into a
 * name→value map (names returned without the leading `--`).
 *
 * @param block - A CSS declaration block body.
 * @returns Map of custom-property name to trimmed value.
 */
export function parseCustomProperties(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    out.set(match[1]!.trim(), match[2]!.trim());
  }
  return out;
}
