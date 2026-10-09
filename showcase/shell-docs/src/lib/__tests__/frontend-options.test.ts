import { expect, test } from "vitest";

import {
  backendFromPathname,
  backendPathForCurrentPath,
  frontendPathForCurrentPath,
  isFrontendOptionActive,
  parseFrontendRoutePath,
  shouldNavigateFrontendSelection,
} from "../frontend-options";
import {
  getFrontendContentSlug,
  getFrontendCanonicalSlug,
  getFrontendReferenceSlug,
  getFrontendQuickstartNavTree,
} from "../frontend-page-content";
import {
  buildBreadcrumbs,
  loadDoc,
  navSectionTitleForSlug,
  visibleGuideBreadcrumbs,
} from "../docs-render";
import { resolveFrontendDocPage } from "../frontend-doc-policy";
import { resolveDocsHref } from "../docs-link-rewrite";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "../angular-doc-navigation";
import { navTreeToPageTree } from "../page-tree-bridge";
import type * as PageTree from "fumadocs-core/page-tree";

function collectPageUrls(tree: PageTree.Root): string[] {
  const urls: string[] = [];

  function visit(nodes: PageTree.Node[]) {
    for (const node of nodes) {
      if (node.type === "page") urls.push(node.url);
      if (node.type === "folder") {
        if (node.index) urls.push(node.index.url);
        visit(node.children);
      }
    }
  }

  visit(tree.children);
  return urls;
}

test("maps picker selections across frontend URL shapes", () => {
  const backendSlugs = ["built-in-agent", "langgraph-python", "mastra"];

  expect(
    frontendPathForCurrentPath("react", "/slack/concepts/architecture"),
  ).toBe("/concepts/architecture");
  expect(frontendPathForCurrentPath("teams", "/quickstart")).toBe("/teams");
  expect(
    frontendPathForCurrentPath(
      "slack",
      "/langgraph-python/quickstart",
      backendSlugs,
    ),
  ).toBe("/slack/langgraph-python");
  expect(
    frontendPathForCurrentPath(
      "react",
      "/vue/langgraph-python/concepts/architecture",
      backendSlugs,
    ),
  ).toBe("/langgraph-python/concepts/architecture");
});

test("keeps an active React selection on its current docs page", () => {
  const pathname = "/mastra/quickstart";
  const destinationPath = frontendPathForCurrentPath("react", pathname, [
    "mastra",
  ]);

  expect(destinationPath).toBe("/mastra");
  expect(
    shouldNavigateFrontendSelection(
      "react",
      "react",
      pathname,
      destinationPath,
    ),
  ).toBe(false);
});

test("keeps the current frontend option active", () => {
  expect(isFrontendOptionActive("react", "react", "/mastra/quickstart")).toBe(
    true,
  );
});

test("keeps mapped channel guides when switching between Slack and Teams", () => {
  const backendSlugs = ["built-in-agent", "langgraph-fastapi", "mastra"];

  expect(
    frontendPathForCurrentPath("teams", "/slack/mastra/tools", backendSlugs),
  ).toBe("/teams/mastra/tools");
  expect(
    frontendPathForCurrentPath(
      "slack",
      "/teams/langgraph-fastapi/threads-and-state",
      backendSlugs,
    ),
  ).toBe("/slack/langgraph-fastapi/threads-and-state");
});

test("drops channel guides at each in-app frontend quickstart", () => {
  const backendSlugs = ["built-in-agent", "mastra"];

  expect(
    frontendPathForCurrentPath("react", "/slack/mastra/tools", backendSlugs),
  ).toBe("/mastra");
  expect(
    frontendPathForCurrentPath("vue", "/slack/mastra/tools", backendSlugs),
  ).toBe("/vue/mastra");
  expect(
    frontendPathForCurrentPath("angular", "/slack/mastra/tools", backendSlugs),
  ).toBe("/angular/mastra/quickstart");
  expect(
    frontendPathForCurrentPath("angular", "/slack/tools", backendSlugs),
  ).toBe("/angular");
  expect(
    frontendPathForCurrentPath(
      "react-native",
      "/slack/mastra/tools",
      backendSlugs,
    ),
  ).toBe("/react-native/mastra");
});

test("drops in-app topics when switching to a channel frontend", () => {
  const backendSlugs = ["built-in-agent", "mastra"];

  expect(
    frontendPathForCurrentPath(
      "slack",
      "/vue/mastra/concepts/architecture",
      backendSlugs,
    ),
  ).toBe("/slack/mastra");
  expect(
    frontendPathForCurrentPath(
      "teams",
      "/vue/mastra/concepts/architecture",
      backendSlugs,
    ),
  ).toBe("/teams/mastra");
  expect(
    frontendPathForCurrentPath("teams", "/concepts/architecture", backendSlugs),
  ).toBe("/teams");
});

test("keeps channel quickstarts and in-app topic transitions coherent", () => {
  const backendSlugs = ["built-in-agent", "mastra"];

  expect(frontendPathForCurrentPath("vue", "/slack/mastra", backendSlugs)).toBe(
    "/vue/mastra",
  );
  expect(
    frontendPathForCurrentPath("teams", "/slack/mastra", backendSlugs),
  ).toBe("/teams/mastra");
  expect(
    frontendPathForCurrentPath(
      "react",
      "/vue/mastra/concepts/architecture",
      backendSlugs,
    ),
  ).toBe("/mastra/concepts/architecture");
  expect(
    frontendPathForCurrentPath(
      "vue",
      "/mastra/concepts/architecture",
      backendSlugs,
    ),
  ).toBe("/vue/mastra/concepts/architecture");
});

test("routes channel roots to Angular's canonical quickstart", () => {
  const backendSlugs = ["built-in-agent", "mastra"];

  expect(
    frontendPathForCurrentPath("angular", "/slack/mastra", backendSlugs),
  ).toBe("/angular/mastra/quickstart");
  expect(frontendPathForCurrentPath("angular", "/slack", backendSlugs)).toBe(
    "/angular",
  );
});

test("keeps Angular on its frontend quickstart when switching backends", () => {
  const backendSlugs = ["built-in-agent", "langgraph-python", "mastra"];

  expect(
    backendPathForCurrentPath(
      "mastra",
      "/angular",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/angular/mastra/quickstart");
  expect(
    backendPathForCurrentPath(
      "langgraph-python",
      "/angular/mastra/quickstart",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/angular/langgraph-python/quickstart");
  expect(
    backendPathForCurrentPath(
      "built-in-agent",
      "/angular/mastra/quickstart",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/angular");
});

test("preserves an Angular backend overview when switching backends", () => {
  const backendSlugs = ["built-in-agent", "langgraph-python", "mastra"];

  expect(
    backendPathForCurrentPath(
      "langgraph-python",
      "/angular/mastra",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/angular/langgraph-python");
});

test("parses and builds two-axis frontend/backend routes", () => {
  const backendSlugs = ["built-in-agent", "langgraph-python", "mastra"];

  expect(
    parseFrontendRoutePath(
      "/vue/langgraph-python/concepts/architecture",
      backendSlugs,
    ),
  ).toEqual({
    frontend: "vue",
    backend: "langgraph-python",
    slugPath: "concepts/architecture",
  });
  expect(parseFrontendRoutePath("/vue/using-these-docs", backendSlugs)).toEqual(
    {
      frontend: "vue",
      backend: null,
      slugPath: "using-these-docs",
    },
  );
  expect(backendFromPathname("/vue/langgraph-python", backendSlugs)).toBe(
    "langgraph-python",
  );
  expect(backendFromPathname("/langgraph-python", backendSlugs)).toBe(
    "langgraph-python",
  );
  expect(
    backendPathForCurrentPath(
      "langgraph-python",
      "/vue",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/vue/langgraph-python");
  expect(
    backendPathForCurrentPath(
      "mastra",
      "/vue/langgraph-python/concepts/architecture",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/vue/mastra/concepts/architecture");
  expect(
    backendPathForCurrentPath(
      "built-in-agent",
      "/vue/langgraph-python",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/vue");
  expect(
    backendPathForCurrentPath(
      "mastra",
      "/slack/tools",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/slack/mastra/tools");
  expect(
    backendPathForCurrentPath(
      "built-in-agent",
      "/teams/mastra/threads-and-state",
      backendSlugs,
      "built-in-agent",
    ),
  ).toBe("/teams/threads-and-state");
});

test("routes Angular interaction capture to the standalone collector", () => {
  const captureSlug = "intelligence/capture-interactions";
  const collectorSlug = "intelligence/standalone-collector";

  expect(getFrontendCanonicalSlug("angular", captureSlug)).toBe(collectorSlug);
  expect(resolveFrontendDocPage("angular", captureSlug)).toEqual({
    status: "not-found",
  });
  expect(resolveAngularDoc(null, captureSlug)).toBeNull();
  expect(resolveAngularDoc(null, collectorSlug)).toMatchObject({
    contentSlugPath: collectorSlug,
    source: "shared",
  });

  const pageUrls = collectPageUrls(
    navTreeToPageTree(getAngularDocsNavTree(null), "/angular"),
  );
  expect(pageUrls).toContain(`/angular/${collectorSlug}`);
  expect(pageUrls).not.toContain(`/angular/${captureSlug}`);
});

test("canonicalizes React-only frontend topics to Angular-native task guides", () => {
  expect(getFrontendCanonicalSlug("angular", "frontend-tools")).toBe(
    "guides/frontend-tools-generative-ui",
  );
  expect(
    getFrontendCanonicalSlug(
      "angular",
      "prebuilt-components/copilot-threads-drawer",
    ),
  ).toBe("guides/threads-memory-attachments-headless");
  expect(getFrontendCanonicalSlug("angular", "intelligence/overview")).toBe(
    "intelligence/overview",
  );
  expect(
    getFrontendCanonicalSlug(
      "angular",
      "(other)/contributing/code-contributions",
    ),
  ).toBe("contributing/code-contributions");
  expect(
    getFrontendCanonicalSlug("angular", "generative-ui/a2ui/styling"),
  ).toBe("guides/a2ui");
  expect(getFrontendCanonicalSlug("angular", "voice")).toBe(
    "guides/voice-multimodal",
  );
  expect(getFrontendCanonicalSlug("angular", "multimodal-attachments")).toBe(
    "guides/voice-multimodal",
  );
  expect(getFrontendCanonicalSlug("angular", "generative-ui/hashbrown")).toBe(
    "guides/a2ui",
  );
  expect(getFrontendCanonicalSlug("angular", "generative-ui/json-render")).toBe(
    "guides/a2ui",
  );
  expect(getFrontendCanonicalSlug("angular", "deploy-agentcore")).toBe(
    "deploy/agentcore",
  );
  expect(getFrontendCanonicalSlug("angular", "deploy/agentcore")).toBe(
    "deploy/agentcore",
  );
  expect(
    getFrontendCanonicalSlug("angular", "a2a/generative-ui/declarative-a2ui"),
  ).toBe("guides/a2ui");
});

test("does not link breadcrumbs for section-only paths", () => {
  const breadcrumbs = buildBreadcrumbs("backend/copilot-runtime", {
    rootLabel: "Docs",
    rootHref: "/angular",
    slugHrefPrefix: "/angular",
  });

  expect(breadcrumbs).toEqual([
    { label: "Docs", href: "/angular" },
    { label: "Runtime", href: null },
    { label: "Copilot Runtime", href: null },
  ]);
});

test("omits only the generic Docs root from visible guide breadcrumbs", () => {
  expect(
    visibleGuideBreadcrumbs([
      { label: "Docs", href: "/" },
      { label: "Concepts", href: null },
      { label: "Architecture", href: null },
    ]),
  ).toEqual([{ label: "Concepts", href: null }]);

  expect(
    visibleGuideBreadcrumbs([
      { label: "LangGraph", href: "/langgraph" },
      { label: "Concepts", href: null },
      { label: "Architecture", href: null },
    ]),
  ).toEqual([
    { label: "LangGraph", href: "/langgraph" },
    { label: "Concepts", href: null },
  ]);

  expect(
    visibleGuideBreadcrumbs([
      { label: "Docs", href: "/" },
      { label: "Cookbook", href: "/cookbook" },
      { label: "Recipe", href: null },
    ]),
  ).toEqual([{ label: "Cookbook", href: "/cookbook" }]);
});

test("keeps the sidebar section in nested guide breadcrumbs", () => {
  const navTree = [
    { type: "section" as const, title: "Concepts" },
    {
      type: "group" as const,
      title: "Agentic Protocols",
      slug: "agentic-protocols",
      children: [
        {
          type: "page" as const,
          title: "AG-UI",
          slug: "agentic-protocols/ag-ui",
        },
      ],
    },
  ];
  const sectionTitle = navSectionTitleForSlug(
    navTree,
    "agentic-protocols/ag-ui",
  );

  expect(sectionTitle).toBe("Concepts");
  expect(
    visibleGuideBreadcrumbs(
      [
        { label: "Docs", href: "/" },
        { label: "Agentic Protocols", href: "/agentic-protocols" },
        { label: "AG-UI", href: null },
      ],
      sectionTitle,
    ),
  ).toEqual([
    { label: "Concepts", href: null },
    { label: "Agentic Protocols", href: "/agentic-protocols" },
  ]);
});

test("routes frontend sidebars to the most specific reference docs available", () => {
  expect(getFrontendReferenceSlug("angular")).toBe("reference/angular");
  expect(getFrontendReferenceSlug("react-native")).toBe(
    "reference/react-native",
  );
  expect(getFrontendReferenceSlug("slack")).toBe("reference/channels");
  expect(getFrontendReferenceSlug("vue")).toBe("reference");
  expect(getFrontendReferenceSlug("teams")).toBe("reference/channels");
});

test("links the Vue quickstart to its guide with an href that survives rewriting", () => {
  const quickstart = loadDoc(getFrontendContentSlug("vue"));
  const href = quickstart?.source.match(
    /\]\((\S*guides\/generative-ui)\)/,
  )?.[1];

  // A relative or root-relative href is passed through untouched by
  // resolveDocsHref, so the browser would resolve it against `/vue` and land
  // on `/guides/generative-ui`, which does not exist.
  expect(href).toBe("/vue/guides/generative-ui");

  const rendered = resolveDocsHref(href, { slugHrefPrefix: "/vue" });
  expect(rendered).toBe("/vue/guides/generative-ui");
  expect(resolveFrontendDocPage("vue", "guides/generative-ui").status).toBe(
    "found",
  );
});

test("keeps frontends without guides free of an empty Guides section", () => {
  const navTree = getFrontendQuickstartNavTree("react-native");

  expect(navTree).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "section", title: "Guides" }),
    ]),
  );
});
