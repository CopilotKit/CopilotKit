import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The framework-root heroes copy the same onboarding prompt the docs-page
 * tools copy, so they need the same two inputs: the page's own `.mdx` URL
 * and the resolved frontend. Both props are optional, so a render site that
 * forgets them still compiles and still renders — the prompt just silently
 * drops the frontend and the page sentence. Asserted on the source because
 * these render sites sit inside a large async route component whose
 * dependencies (MDX compilation, the nav tree, the registry) make mounting
 * it impractical.
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

describe("framework root hero prompt inputs", () => {
  for (const tag of ["<FrameworkOverview", "<MdxFrameworkOverview"] as const) {
    it(`passes markdownUrl and onboardingFrontend at ${tag}`, () => {
      const source = fs.readFileSync(ROUTE, "utf-8");
      const renders = source.split(tag).slice(1);

      expect(renders).toHaveLength(1);
      for (const chunk of renders) {
        const attributes = openingTagAttributes(chunk);
        expect(attributes).toContain("markdownUrl");
        expect(attributes).toContain("onboardingFrontend");
      }
    });
  }
});
