import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  openingTagAttributes,
  valuedPropPattern,
} from "@/test-utils/jsx-source";

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

describe("framework root hero prompt inputs", () => {
  for (const tag of ["<FrameworkOverview", "<MdxFrameworkOverview"] as const) {
    it(`passes markdownUrl and onboardingFrontend at ${tag}`, () => {
      const source = fs.readFileSync(ROUTE, "utf-8");
      const renders = source.split(tag).slice(1);

      expect(renders).toHaveLength(1);
      for (const chunk of renders) {
        const attributes = openingTagAttributes(chunk);
        // A value, not just the name — `markdownUrl={undefined}` and
        // `markdownUrl={""}` both compile and would satisfy a substring
        // match while dropping the page sentence.
        expect(attributes).toMatch(valuedPropPattern("markdownUrl"));
        expect(attributes).toMatch(valuedPropPattern("onboardingFrontend"));
      }
    });
  }
});
