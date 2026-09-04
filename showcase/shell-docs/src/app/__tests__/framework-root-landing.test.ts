import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  booleanPropPattern,
  renderSiteAttributes,
} from "@/test-utils/jsx-source";

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

describe("framework root pages", () => {
  it("passes landingPage at every framework-root DocsPageView", () => {
    const attributesList = renderSiteAttributes(
      ROUTE,
      "<DocsPageView",
      (chunk) => chunk.includes("contentSlugPath={indexContentPath}"),
    );

    expect(attributesList).toHaveLength(2);
    for (const attributes of attributesList) {
      // Bare attribute or an explicitly truthy value only — a plain
      // substring match would also accept `landingPage={false}`.
      expect(attributes).toMatch(booleanPropPattern("landingPage"));
    }
  });
});
