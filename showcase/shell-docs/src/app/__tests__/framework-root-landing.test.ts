import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Both framework-root branches must ask for landing mode. Asserted on the
 * source because the branches sit inside a large async route component whose
 * dependencies (MDX compilation, the nav tree, the registry) make mounting it
 * impractical, and because the failure this guards against is someone adding
 * a third branch and forgetting the prop.
 */
const ROUTE = path.join(
  process.cwd(),
  "src/app/[framework]/[[...slug]]/page.tsx",
);

/**
 * The attributes of the opening JSX tag that `chunk` starts with. Walks to
 * the first `>` that is not nested inside a `{…}` expression or a string, so
 * it holds for a self-closing render and for one with children alike.
 */
function openingTagAttributes(chunk: string): string {
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

describe("framework root pages", () => {
  it("passes landingPage at every framework-root DocsPageView", () => {
    const source = fs.readFileSync(ROUTE, "utf-8");
    const rootRenders = source
      .split("<DocsPageView")
      .slice(1)
      .filter((chunk) => chunk.includes("contentSlugPath={indexContentPath}"));

    expect(rootRenders).toHaveLength(2);
    for (const chunk of rootRenders) {
      // Bare attribute or an explicitly truthy value only — a plain
      // substring match would also accept `landingPage={false}`.
      expect(openingTagAttributes(chunk)).toMatch(
        /landingPage(?:=\{true\}|(?=[\s/>]))/,
      );
    }
  });
});
