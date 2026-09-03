import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function read(relativeFromSrc: string) {
  return readFileSync(resolve(here, "../..", relativeFromSrc), "utf8");
}

test("the Intelligence overview hides the default docs header", () => {
  const page = matter(read("content/docs/intelligence/overview.mdx"));
  const parser = read("lib/docs-render.tsx");

  expect(page.data.hideHeader).toBe(true);
  expect(parser).toContain("const hideHeader = data.hideHeader === true");
});

test("the shared Intelligence overview mounts the landing then keeps platform copy", () => {
  const snippet = read("content/snippets/shared/intelligence/overview.mdx");

  expect(snippet).toContain("<IntelligenceOverview");
  expect(snippet.indexOf("<IntelligenceOverview")).toBeLessThan(
    snippet.indexOf("## What is CopilotKit Intelligence?"),
  );
  expect(snippet).toContain("## What the platform adds");
  expect(snippet).toContain("## Hosting options");
});

test("the MDX registry and page view wire IntelligenceOverview and hideHeader", () => {
  const registry = read("lib/mdx-registry.tsx");
  const pageView = read("components/docs-page-view.tsx");

  expect(registry).toContain(
    'from "@/components/content/landing-pages/intelligence-overview"',
  );
  expect(registry).toContain("IntelligenceOverview,");
  expect(pageView).toContain("!doc.fm.hideHeader");
});
