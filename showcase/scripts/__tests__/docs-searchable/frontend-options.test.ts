import { expect, test } from "vitest";

// Before lib/docs-searchable: it reads shell-docs relative to the cwd.
import "./shell-docs-cwd";

import {
  backendFromPathname,
  backendPathForCurrentPath,
  frontendPathForCurrentPath,
  isFrontendOptionActive,
  parseFrontendRoutePath,
  shouldNavigateFrontendSelection,
} from "../../lib/docs-searchable/frontend-options";
import {
  frontendHasPage,
  getFrontendContentSlug,
  getFrontendCanonicalSlug,
  getFrontendReferenceSlug,
  getFrontendQuickstartNavTree,
} from "../../lib/docs-searchable/frontend-page-content";
import {
  buildBreadcrumbs,
  loadDoc,
  navSectionTitleForSlug,
  visibleGuideBreadcrumbs,
} from "../../lib/docs-searchable/docs-render";
import type { NavNode } from "../../lib/docs-searchable/docs-render";

// The first docs app's page-tree, Angular-navigation and link-rewrite modules
// were not moved with these rules, so the assertions on them were dropped;
// what's left covers the moved code.

/** The pages a sidebar lists: authored hrefs, else the slug under `prefix`. */
function collectPageUrls(nodes: NavNode[], prefix: string): string[] {
  return nodes.flatMap((node) => {
    if (node.type === "page") return [node.href ?? `${prefix}/${node.slug}`];
    if (node.type === "group") return collectPageUrls(node.children, prefix);
    return [];
  });
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

test("gives Angular its own page at the React topic's slug", () => {
  // Angular's pages live at React's slugs, so a topic keeps its slug.
  expect(getFrontendCanonicalSlug("angular", "frontend-tools")).toBe(
    "frontend-tools",
  );
  expect(frontendHasPage("angular", "frontend-tools")).toBe(true);
  expect(frontendHasPage("angular", "headless-threads")).toBe(true);
  expect(
    getFrontendCanonicalSlug(
      "angular",
      "(other)/contributing/code-contributions",
    ),
  ).toBe("contributing/code-contributions");
  // Capture is a React page (docs/intelligence); the collector is shared.
  expect(frontendHasPage("angular", "intelligence/capture-interactions")).toBe(
    false,
  );
  expect(frontendHasPage("angular", "intelligence/standalone-collector")).toBe(
    true,
  );
});

test("keeps Angular and React Native sidebar links reachable", () => {
  for (const id of ["angular", "react-native"] as const) {
    const urls = collectPageUrls(getFrontendQuickstartNavTree(id), `/${id}`);
    expect(urls).toContain(`/${id}/frontend-tools`);
    for (const url of urls.filter((href) => href.startsWith(`/${id}/`))) {
      expect(frontendHasPage(id, url.slice(id.length + 2)), url).toBe(true);
    }
  }
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
  expect(getFrontendReferenceSlug("vue")).toBe("reference/vue");
  expect(getFrontendReferenceSlug("teams")).toBe("reference/channels");
});

test("keeps Vue sidebar links reachable", () => {
  const urls = collectPageUrls(getFrontendQuickstartNavTree("vue"), "/vue");
  expect(urls).toEqual(
    expect.arrayContaining([
      "/vue/AG-UI-Streams",
      "/vue/generative-ui/tool-rendering",
    ]),
  );
  for (const url of urls.filter((href) => href.startsWith("/vue/"))) {
    expect(frontendHasPage("vue", url.slice("/vue/".length)), url).toBe(true);
  }
});

test("links the Vue quickstart to a reachable Vue guide", () => {
  const quickstart = loadDoc(getFrontendContentSlug("vue"));
  const href = quickstart?.source.match(
    /\]\((\/vue\/generative-ui\/tool-based)\)/,
  )?.[1];

  expect(href).toBe("/vue/generative-ui/tool-based");
  expect(frontendHasPage("vue", "generative-ui/tool-based")).toBe(true);
});

test("keeps frontends without guides free of an empty Guides section", () => {
  const navTree = getFrontendQuickstartNavTree("react-native");

  expect(navTree).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "section", title: "Guides" }),
    ]),
  );
});
