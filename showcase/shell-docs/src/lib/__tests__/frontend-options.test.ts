import React from "react";
import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FRONTEND_OPTIONS,
  backendFromPathname,
  backendPathForCurrentPath,
  frontendFromPathname,
  frontendPathFor,
  frontendPathForBackend,
  frontendPathForCurrentPath,
  getFrontendOption,
  isChannelFrontend,
  isFrontendOptionActive,
  isFrontendId,
  parseFrontendRoutePath,
  shouldNavigateFrontendSelection,
} from "../frontend-options";
import {
  FRONTEND_DOCS_STATUS_CONTENT_SLUG,
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
  getFrontendCanonicalSlug,
  getFrontendGuidanceContentSlug,
  getFrontendGuidanceTitle,
  getFrontendReferenceSlug,
  getFrontendQuickstartNavTree,
  getFrontendUsingTheseDocsPath,
} from "../frontend-page-content";
import { buildBreadcrumbs, loadDoc } from "../docs-render";
import type { NavNode } from "../docs-render";
import { resolveFrontendDocPage } from "../frontend-doc-policy";
import { resolveDocsHref } from "../docs-link-rewrite";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "../angular-doc-navigation";
import { CHANNEL_GUIDE_ROUTES } from "../channel-guide-routes";
import { navTreeToPageTree } from "../page-tree-bridge";
import type * as PageTree from "fumadocs-core/page-tree";

function flattenNavTree(tree: NavNode[]): NavNode[] {
  return tree.flatMap((node) =>
    node.type === "group" ? [node, ...flattenNavTree(node.children)] : [node],
  );
}

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

function renderNavNameToMarkup(name: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, name));
}

const angularGuideSlugs = [
  "guides/chat-ui",
  "guides/frontend-tools-generative-ui",
  "guides/a2ui",
  "guides/voice-multimodal",
  "guides/human-in-the-loop",
  "guides/shared-state",
  "guides/threads-memory-attachments-headless",
  "guides/troubleshooting",
] as const;

test("keeps React as the full docs surface and routes other frontends to their guides", () => {
  expect(frontendPathFor("react")).toBe("/");
  expect(frontendPathFor("vue")).toBe("/vue");
  expect(frontendPathFor("react-native")).toBe("/react-native");
  expect(frontendPathFor("react", "concepts/architecture")).toBe(
    "/concepts/architecture",
  );
  expect(frontendPathFor("slack", "concepts/architecture")).toBe(
    "/slack/concepts/architecture",
  );
  expect(frontendPathFor("react", "quickstart")).toBe("/");
  expect(frontendPathFor("slack", "quickstart")).toBe("/slack");
  expect(frontendPathFor("teams", "quickstart")).toBe("/teams");
  expect(frontendPathFor("slack", "connect")).toBe("/slack/connect");
  expect(frontendPathFor("teams", "connect")).toBe("/teams/connect");
  expect(frontendPathFor("react", "using-these-docs")).toBe("/");
  expect(frontendFromPathname("/vue")).toBe("vue");
  expect(frontendFromPathname("/vue/concepts/architecture")).toBe("vue");
  expect(frontendFromPathname("/react")).toBeNull();
  expect(frontendFromPathname("/frontends/vue")).toBeNull();
  expect(frontendFromPathname("/langgraph-python/quickstart")).toBeNull();
});

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

test("maps every non-React frontend to an MDX guide page", () => {
  const nonReactIds = FRONTEND_OPTIONS.filter(
    (option) => option.id !== "react",
  ).map((option) => option.id);

  expect(FRONTEND_PAGE_IDS).toEqual(nonReactIds);
  for (const id of FRONTEND_PAGE_IDS) {
    expect(isFrontendId(id)).toBe(true);
    expect(getFrontendOption(id).name).toBeTruthy();
    expect(getFrontendContentSlug(id)).toBe(`frontends/${id}`);
    expect(getFrontendUsingTheseDocsPath(id)).toBe(`/${id}/using-these-docs`);
    expect(loadDoc(getFrontendContentSlug(id))?.fm.title).toBeTruthy();
  }
  expect(isChannelFrontend("vue")).toBe(false);
  expect(isChannelFrontend("react-native")).toBe(false);
  expect(isChannelFrontend("slack")).toBe(true);
  expect(isChannelFrontend("teams")).toBe(true);
  expect(loadDoc(FRONTEND_DOCS_STATUS_CONTENT_SLUG)?.fm.title).toBe(
    "Docs status",
  );
  expect(getFrontendGuidanceContentSlug("vue")).toBe(
    FRONTEND_DOCS_STATUS_CONTENT_SLUG,
  );
  expect(getFrontendGuidanceContentSlug("angular")).toBe(
    "frontends/angular/docs-status",
  );
  expect(getFrontendGuidanceContentSlug("slack")).toBe(
    FRONTEND_DOCS_STATUS_CONTENT_SLUG,
  );
  expect(getFrontendGuidanceTitle("vue")).toBe("Docs status");
  expect(getFrontendGuidanceTitle("slack")).toBe("Docs status");
  expect(isChannelFrontend("react")).toBe(false);
});

test("gives Angular native guides plus shared product documentation", () => {
  const guidance = loadDoc(getFrontendGuidanceContentSlug("angular"));
  const pageUrls = collectPageUrls(
    navTreeToPageTree(getAngularDocsNavTree(null), "/angular"),
  );

  expect(guidance?.source).not.toMatch(/React/i);
  expect(pageUrls).toContain("/angular/features");
  expect(pageUrls).toContain("/reference/angular");
  expect(getFrontendQuickstartNavTree("angular")).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        variant: expect.stringMatching(
          /react-docs-proxy|frontend-docs-upcoming/,
        ),
      }),
    ]),
  );
  expect(resolveFrontendDocPage("angular", "features")).toEqual(
    expect.objectContaining({
      status: "found",
      slugPath: "features",
      contentSlugPath: "frontends/angular/features",
    }),
  );
  expect(resolveAngularDoc(null, "concepts/architecture")).toEqual(
    expect.objectContaining({
      contentSlugPath: "concepts/architecture",
      framework: "built-in-agent",
      source: "shared",
    }),
  );
  expect(pageUrls).toContain("/angular/concepts/architecture");
  expect(pageUrls).toContain("/angular/backend/copilot-runtime");
  expect(pageUrls).toContain("/angular/intelligence/intelligence-platform");
  expect(getFrontendCanonicalSlug("angular", "docs-status")).toBe(
    "using-these-docs",
  );
});

test("publishes Angular task guides in unscoped and backend-scoped routes", () => {
  const pageUrls = collectPageUrls(
    navTreeToPageTree(getAngularDocsNavTree(null), "/angular"),
  );

  for (const slug of angularGuideSlugs) {
    expect(pageUrls).toContain(`/angular/${slug}`);
    expect(resolveFrontendDocPage("angular", slug)).toEqual(
      expect.objectContaining({
        status: "found",
        slugPath: slug,
        contentSlugPath: `frontends/angular/${slug}`,
        canonicalPath: `/angular/${slug}`,
      }),
    );
    expect(frontendPathForBackend("angular", slug, "langgraph-python")).toBe(
      `/angular/langgraph-python/${slug}`,
    );
  }
});

test("keeps Angular backend docs in context without a frontend-backend copy tree", () => {
  const prefix = "/angular/langgraph-python";
  const pageUrls = collectPageUrls(
    navTreeToPageTree(getAngularDocsNavTree("langgraph-python"), prefix),
  );

  expect(pageUrls).toContain(prefix);
  expect(pageUrls).toContain(`${prefix}/quickstart`);
  expect(pageUrls).toContain(`${prefix}/concepts/architecture`);
  expect(pageUrls).toContain(`${prefix}/backend/copilot-runtime`);
  expect(pageUrls).toContain(`${prefix}/intelligence/intelligence-platform`);
  expect(pageUrls).toContain(`${prefix}/auth`);
  expect(pageUrls).toContain(`${prefix}/guides/frontend-tools-generative-ui`);
  expect(resolveAngularDoc("langgraph-python", "auth")).toEqual(
    expect.objectContaining({
      contentSlugPath: "frontends/angular/auth",
      framework: "langgraph-python",
      source: "angular",
    }),
  );
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

test("routes frontend sidebars to the most specific reference docs available", () => {
  expect(getFrontendReferenceSlug("angular")).toBe("reference/angular");
  expect(getFrontendReferenceSlug("react-native")).toBe(
    "reference/react-native",
  );
  expect(getFrontendReferenceSlug("slack")).toBe("reference/channels");
  expect(getFrontendReferenceSlug("vue")).toBe("reference");
  expect(getFrontendReferenceSlug("teams")).toBe("reference/channels");
});

test("gives Slack and Teams the maintained Channels journey", () => {
  const slackNav = getFrontendQuickstartNavTree("slack");
  const teamsNav = getFrontendQuickstartNavTree("teams");
  const gettingStartedPages = CHANNEL_GUIDE_ROUTES.filter(
    (route) => route.section === "getting-started" && route.slug !== "overview",
  ).map(({ navTitle: title, slug }) => ({ type: "page", title, slug }));
  const buildPages = CHANNEL_GUIDE_ROUTES.filter(
    (route) => route.section === "build",
  ).map(({ navTitle: title, slug }) => ({ type: "page", title, slug }));
  const productionPages = CHANNEL_GUIDE_ROUTES.filter(
    (route) => route.section === "production",
  ).map(({ navTitle: title, slug }) => ({ type: "page", title, slug }));
  const expectedNav = [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Overview", slug: "" },
    ...gettingStartedPages,
    {
      type: "page",
      title: "Connect and run your agent",
      slug: "connect",
    },
    { type: "section", title: "Build", icon: "lucide/Wand2" },
    ...buildPages,
    { type: "section", title: "Production", icon: "lucide/ServerCog" },
    ...productionPages,
    {
      type: "page",
      title: "API reference",
      slug: "reference/channels",
      href: "/reference/channels",
    },
  ];

  for (const nav of [slackNav, teamsNav]) {
    expect(nav).toEqual(expectedNav);
    expect(nav).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variant: "frontend-docs-upcoming" }),
      ]),
    );
    expect(flattenNavTree(nav)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: expect.stringMatching(/^\/channels/) }),
      ]),
    );
  }
});

test("builds the exact channel journey beneath every active prefix", () => {
  const navTree = getFrontendQuickstartNavTree("slack");
  const flattenedNavTree = flattenNavTree(navTree);

  expect(flattenedNavTree).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "section",
        title: "Concepts",
        variant: "react-docs-proxy",
      }),
      expect.objectContaining({
        type: "page",
        title: "Architecture",
        variant: "react-docs-proxy",
      }),
    ]),
  );

  expect(flattenedNavTree).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ variant: "react-docs-proxy" }),
    ]),
  );

  const pageUrls = collectPageUrls(navTreeToPageTree(navTree, "/slack"));
  expect(pageUrls).toEqual([
    "/slack",
    "/slack/intelligence",
    "/slack/connect",
    ...CHANNEL_GUIDE_ROUTES.filter(
      ({ slug }) => !["overview", "intelligence"].includes(slug),
    ).map(({ slug }) => `/slack/${slug}`),
    "/reference/channels",
  ]);
  expect(
    collectPageUrls(navTreeToPageTree(navTree, "/slack/langgraph-fastapi")),
  ).toEqual([
    "/slack/langgraph-fastapi",
    "/slack/langgraph-fastapi/intelligence",
    "/slack/langgraph-fastapi/connect",
    ...CHANNEL_GUIDE_ROUTES.filter(
      ({ slug }) => !["overview", "intelligence"].includes(slug),
    ).map(({ slug }) => `/slack/langgraph-fastapi/${slug}`),
    "/reference/channels",
  ]);
  expect(
    collectPageUrls(
      navTreeToPageTree(getFrontendQuickstartNavTree("teams"), "/teams/mastra"),
    ),
  ).toEqual([
    "/teams/mastra",
    "/teams/mastra/intelligence",
    "/teams/mastra/connect",
    ...CHANNEL_GUIDE_ROUTES.filter(
      ({ slug }) => !["overview", "intelligence"].includes(slug),
    ).map(({ slug }) => `/teams/mastra/${slug}`),
    "/reference/channels",
  ]);
  expect(pageUrls).not.toEqual(
    expect.arrayContaining([
      "/concepts/architecture",
      "/slack/concepts/architecture",
      "/slack/concepts/which-hook",
      "/slack/prebuilt-components",
      "/prebuilt-components",
    ]),
  );

  expect(getFrontendQuickstartNavTree("vue")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "section",
        variant: "frontend-docs-upcoming",
        frontendDocsStatus: "feature-complete",
      }),
    ]),
  );
  expect(resolveFrontendDocPage("slack", "agentic-protocols")).toEqual(
    expect.objectContaining({
      status: "found",
      slugPath: "agentic-protocols",
      contentSlugPath: "agentic-protocols",
      canonicalPath: "/slack/agentic-protocols",
    }),
  );
});

test("renders docs-catch-up copy only for frontends that still use it", () => {
  const vueTree = navTreeToPageTree(
    getFrontendQuickstartNavTree("vue"),
    "/vue",
  );
  const slackTree = navTreeToPageTree(
    getFrontendQuickstartNavTree("slack"),
    "/slack",
  );

  const vueUpcoming = vueTree.children.find(
    (node) =>
      node.type === "separator" &&
      renderNavNameToMarkup(node.name).includes("Guides coming soon"),
  );
  const slackUpcoming = slackTree.children.find(
    (node) =>
      node.type === "separator" &&
      renderNavNameToMarkup(node.name).includes("Guides coming soon"),
  );

  expect(renderNavNameToMarkup(vueUpcoming?.name)).toContain(
    "Vue is feature complete, but the docs are still catching up. The ",
  );
  expect(renderNavNameToMarkup(vueUpcoming?.name)).toContain(
    " guides are ready with more guides on the way.",
  );
  expect(slackUpcoming).toBeUndefined();
});

test("publishes the Vue generative UI guide as a reachable sidebar page", () => {
  const pageUrls = collectPageUrls(
    navTreeToPageTree(getFrontendQuickstartNavTree("vue"), "/vue"),
  );

  expect(pageUrls).toContain("/vue/guides/generative-ui");
  expect(resolveFrontendDocPage("vue", "guides/generative-ui")).toEqual(
    expect.objectContaining({
      status: "found",
      slugPath: "guides/generative-ui",
      contentSlugPath: "frontends/vue/guides/generative-ui",
      canonicalPath: "/vue/guides/generative-ui",
    }),
  );
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
