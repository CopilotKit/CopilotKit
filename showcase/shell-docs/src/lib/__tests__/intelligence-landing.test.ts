import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function read(relativeFromSrc: string) {
  return readFileSync(resolve(here, "../..", relativeFromSrc), "utf8");
}

test("the Intelligence overview uses landing-page chrome", () => {
  const page = matter(read("content/docs/intelligence/overview.mdx"));
  const routedPage = matter(
    read("content/docs/integrations/built-in-agent/intelligence/overview.mdx"),
  );
  const parser = read("lib/docs-render.tsx");

  expect(page.data.title).toBe("CopilotKit Intelligence");
  expect(page.data.nav_title).toBe("Overview");
  expect(page.data.description).toBe(
    "CopilotKit Intelligence adds persistent threads, analytics, automatic learning, and production operations on top of the runtime you already run.",
  );
  expect(page.data.hideHeader).toBeUndefined();
  expect(page.data.full).toBe(true);
  expect(page.data.hideBreadcrumb).toBe(true);
  expect(page.data.hideTOC).toBe(true);
  expect(page.data.hidePageActions).toBe(true);
  expect(routedPage.data.title).toBe("CopilotKit Intelligence");
  expect(routedPage.data.nav_title).toBe("Overview");
  expect(routedPage.data.description).toBe(page.data.description);
  expect(routedPage.data.full).toBe(true);
  expect(routedPage.data.hideBreadcrumb).toBe(true);
  expect(routedPage.data.hideTOC).toBe(true);
  expect(routedPage.data.hidePageActions).toBe(true);
  expect(parser).toContain("const hideTOC = data.hideTOC === true");
  expect(parser).toContain("const full = data.full === true");
  expect(parser).toContain(
    "const hideBreadcrumb = data.hideBreadcrumb === true",
  );
  expect(parser).toContain(
    "const hidePageActions = data.hidePageActions === true",
  );
});

test("the shared Intelligence overview mounts the landing then keeps platform copy", () => {
  const snippet = read("content/snippets/shared/intelligence/overview.mdx");

  expect(snippet).toContain("<IntelligenceOverview");
  expect(snippet.indexOf("<IntelligenceOverview")).toBeLessThan(
    snippet.indexOf("## What is CopilotKit Intelligence?"),
  );
  expect(snippet).toContain("## What the platform adds");
  expect(snippet).toContain("| Analytics |");
  expect(snippet).toContain("| Automatic learning |");
  expect(snippet).toContain("[Learning](/learning)");
  expect(snippet).toContain("<IntelligenceFeatureCards");
  expect(snippet).toContain(
    "Follow the Intelligence quickstart to connect your runtime and confirm threads work.",
  );
  expect(snippet).toContain("](/intelligence/quickstart)");
  expect(
    existsSync(resolve(here, "../../content/docs/intelligence/quickstart.mdx")),
  ).toBe(true);
  expect(existsSync(resolve(here, "../../content/docs/learning.mdx"))).toBe(
    true,
  );
  expect(snippet.indexOf("## What the platform adds")).toBeLessThan(
    snippet.indexOf("<IntelligenceFeatureCards"),
  );
  expect(snippet.indexOf("<IntelligenceFeatureCards")).toBeLessThan(
    snippet.indexOf(
      "Follow the Intelligence quickstart to connect your runtime and confirm threads work.",
    ),
  );
  expect(
    snippet.indexOf(
      "Follow the Intelligence quickstart to connect your runtime and confirm threads work.",
    ),
  ).toBeLessThan(snippet.indexOf("## Hosting options"));
  expect(snippet).toContain("## Hosting options");
});

test("the MDX registry and page view wire IntelligenceOverview and its chrome", () => {
  const registry = read("lib/mdx-registry.tsx");
  const pageView = read("components/docs-page-view.tsx");

  expect(registry).toContain(
    'from "@/components/content/landing-pages/intelligence-overview"',
  );
  expect(registry).toContain("IntelligenceOverview,");
  expect(registry).toContain("IntelligenceFeatureCards,");
  expect(pageView).toContain("hideHeading={doc.fm.hideHeader}");
  expect(pageView).toContain("!doc.fm.hidePageActions");
});
