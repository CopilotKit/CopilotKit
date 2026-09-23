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
  const globals = read("app/globals.css");

  expect(page.data.title).toBe("CopilotKit Intelligence");
  expect(page.data.nav_title).toBe("Overview");
  expect(page.data.description).toBe(
    "CopilotKit Intelligence adds Rich Threads, User Memories, Automatic Learning, Channels, and Product Analytics to the CopilotKit app you already run.",
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
  expect(globals).toMatch(
    /article#nd-page\[data-full="true"\][^{]*\{\s*grid-column:\s*main;/,
  );
});

test("the shared Intelligence overview mounts the landing then keeps platform copy", () => {
  const snippet = read("content/snippets/shared/intelligence/overview.mdx");

  expect(snippet).toContain("<IntelligenceOverview");
  expect(snippet.indexOf("<IntelligenceOverview")).toBeLessThan(
    snippet.indexOf("## What is CopilotKit Intelligence?"),
  );
  expect(snippet).toContain("## What is CopilotKit Intelligence?");
  expect(snippet).not.toContain("| Product Analytics |");
  expect(snippet).not.toContain("| Automatic Learning |");
  // The hosting choice is two cards; the architecture comparison lives on
  // the Cloud-hosted and Self-hosted pages, not on the landing.
  expect(snippet).toContain(
    'href: "/intelligence/managed-intelligence-platform"',
  );
  expect(snippet).toContain('href: "/intelligence/self-hosting"');
  expect(snippet).not.toContain(
    "https://www.copilotkit.ai/copilotkit-intelligence",
  );
  expect(
    existsSync(
      resolve(here, "../../content/docs/intelligence/learned-skills.mdx"),
    ),
  ).toBe(true);
  expect(snippet).toContain("<IntelligenceFeatureCards");
  expect(snippet).toContain("](/intelligence/quickstart)");
  expect(
    existsSync(resolve(here, "../../content/docs/intelligence/quickstart.mdx")),
  ).toBe(true);
  expect(existsSync(resolve(here, "../../content/docs/learning.mdx"))).toBe(
    true,
  );
  expect(
    existsSync(resolve(here, "../../content/docs/intelligence/memories.mdx")),
  ).toBe(true);
  expect(snippet.indexOf("## What is CopilotKit Intelligence?")).toBeLessThan(
    snippet.indexOf("<IntelligenceFeatureCards"),
  );
  expect(snippet.indexOf("<IntelligenceFeatureCards")).toBeLessThan(
    snippet.indexOf("## Choose where Intelligence runs"),
  );
  expect(snippet).toContain("## Choose where Intelligence runs");
  expect(
    existsSync(resolve(here, "../../content/docs/intelligence/analytics.mdx")),
  ).toBe(true);
  expect(
    existsSync(resolve(here, "../../content/docs/intelligence/channels.mdx")),
  ).toBe(true);
  expect(
    existsSync(
      resolve(here, "../../content/docs/intelligence/self-hosting-ecs.mdx"),
    ),
  ).toBe(true);
});

test("the Automatic Learning guide stays focused on the reviewed workflow", () => {
  const guide = read("content/docs/learning.mdx");

  expect(guide).toContain("## Overview");
  expect(guide).toContain("## How Automatic Learning works");
  expect(guide).toContain("## Set up Automatic Learning manually");
  expect(guide).toContain("## Start with your coding agent");
  expect(guide).toContain("<LearningSetupPrompt />");
  expect(guide).toContain("### Connect CopilotKit Intelligence");
  expect(guide).toContain("](/intelligence/quickstart)");
  expect(guide).toContain("https://dashboard.operations.copilotkit.ai/");
  expect(guide).toContain(
    "your Runtime will send selected Threads to a Learning container",
  );
  expect(guide).not.toContain("<Cards>");
  expect(guide).not.toContain("You stay in control");
  expect(guide).not.toContain("Before configuring a container:");
  expect(guide).not.toContain("## Choose a useful learning boundary");
  expect(guide).not.toContain("## Enable long-term Memory");
  expect(guide).not.toContain("memory: {");
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

test("the docs home has one onboarding offer without the redundant Intelligence callout", () => {
  const home = read("app/[[...slug]]/page.tsx");
  expect(home.match(/<HeroOnboardingPromptButton\b/g)).toHaveLength(1);
  expect(home.match(/<PromptFolderHint\b/g)).toHaveLength(1);
  expect(home).not.toContain("IntelligenceOnboardingPrompt");
  expect(home).not.toContain("docs_landing_learning");
});
