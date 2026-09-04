/**
 * Helpers for tests that assert on JSX *source text* rather than on a
 * rendered tree.
 *
 * Several render sites we need to pin sit inside large async server
 * components whose dependencies (MDX compilation, the nav tree, the
 * registry) make mounting them impractical, so the guard reads the file and
 * inspects the opening tag instead. This module exists so the parsing rules
 * are written once and every such test agrees on them.
 *
 * Not a `*.test.ts` file, so vitest's `include` glob does not collect it.
 */

import fs from "node:fs";

/**
 * The attributes of the opening JSX tag that `chunk` starts with. Walks to
 * the first `>` that is not nested inside a `{…}` expression or a string, so
 * it holds for a self-closing render and for one with children alike.
 */
export function openingTagAttributes(chunk: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < chunk.length; i++) {
    const char = chunk[i];
    if (quote) {
      if (char === quote && chunk[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (char === ">" && depth === 0) {
      return chunk.slice(0, i);
    }
  }
  return chunk;
}

/**
 * Matches `name={…}` only when the braces hold an expression that can
 * actually carry a value.
 *
 * A plain `toContain("name")` is too weak for the props these guards pin:
 * they are all optional, so `name={undefined}` or `name={""}` compiles,
 * renders, and satisfies a substring match while silently dropping whatever
 * the prop was there to deliver. The negative lookahead rejects exactly the
 * empty values; anything else has to be a real expression.
 */
export function valuedPropPattern(name: string): RegExp {
  return new RegExp(
    // The lookbehind keeps `framework=` from matching inside a longer name
    // such as `onboardingFramework=`.
    `(?<![\\w$])${name}=\\{(?!\\s*(?:undefined|null|""|''|\`\`)\\s*\\})\\s*[^\\s}]`,
  );
}

/**
 * Matches a boolean prop `name` passed as a bare attribute (`landingPage`) or
 * explicitly `name={true}` — never `name={false}`, which a plain substring
 * match would also accept. The counterpart to `valuedPropPattern` above for
 * props whose whole point is being present-or-absent rather than carrying a
 * value.
 */
export function booleanPropPattern(name: string): RegExp {
  return new RegExp(
    // Same lookbehind rationale as `valuedPropPattern`.
    `(?<![\\w$])${name}(?:=\\{true\\}|(?=[\\s/>]))`,
  );
}

/**
 * Reads `filePath`, splits its source on every occurrence of `openTag`
 * (narrowed further by `filter` when given), and returns each render's
 * opening-tag attributes — ready for `valuedPropPattern` or
 * `booleanPropPattern`.
 *
 * Lifts the "read the file, split on the opening tag, extract the opening
 * tag's attributes" driver that recurs across these render-site guards, so
 * that part is written once. How many renders there should be is a
 * property of the test, not of this helper, so callers assert
 * `toHaveLength` on the result themselves rather than this function
 * swallowing that assertion.
 */
export function renderSiteAttributes(
  filePath: string,
  openTag: string,
  filter?: (chunk: string) => boolean,
): string[] {
  const source = fs.readFileSync(filePath, "utf-8");
  let chunks = source.split(openTag).slice(1);
  if (filter) chunks = chunks.filter(filter);
  return chunks.map(openingTagAttributes);
}
