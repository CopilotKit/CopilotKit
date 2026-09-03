import { describe, expect, it } from "vitest";
import path from "node:path";
import { renderSiteAttributes } from "@/test-utils/jsx-source";

/**
 * The docs home hero (the bare `/`) passes `surface="docs_landing_hero"` to
 * its prompt button so the copy event is attributable to this placement.
 * Unlike `docs_framework_hero`, which is pinned at its real placement in
 * `framework-overview.test.tsx`, nothing asserted that this literal actually
 * reaches the root page — a typo here would ship silently. Asserted on the
 * source, not by mounting `DocsOverview`, because that component pulls in
 * the registry and nav-tree builders that make it impractical to render in
 * isolation.
 */
const PAGE = path.join(process.cwd(), "src/app/[[...slug]]/page.tsx");

describe("docs landing hero", () => {
  it("passes the docs_landing_hero surface to the hero prompt button", () => {
    const attributesList = renderSiteAttributes(
      PAGE,
      "<OnboardingPromptButton",
    );

    expect(attributesList).toHaveLength(1);
    expect(attributesList[0]).toContain('surface="docs_landing_hero"');
  });
});
