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

describe("framework root pages", () => {
  it("passes landingPage at every framework-root DocsPageView", () => {
    const source = fs.readFileSync(ROUTE, "utf-8");
    const rootRenders = source
      .split("<DocsPageView")
      .slice(1)
      .filter((chunk) => chunk.includes("contentSlugPath={indexContentPath}"));

    expect(rootRenders).toHaveLength(2);
    for (const chunk of rootRenders) {
      expect(chunk.slice(0, chunk.indexOf("/>"))).toContain("landingPage");
    }
  });
});
