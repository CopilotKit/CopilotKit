import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FRONTEND_OPTIONS,
  backendFromPathname,
  backendPathForCurrentPath,
  frontendFromPathname,
  frontendPathFor,
  frontendPathForCurrentPath,
  getFrontendOption,
  isFrontendEarlyAccess,
  isFrontendId,
  parseFrontendRoutePath,
} from "../frontend-options";
import {
  FRONTEND_DOCS_STATUS_CONTENT_SLUG,
  FRONTEND_GUIDANCE_CONTENT_SLUG,
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
  getFrontendGuidanceContentSlug,
  getFrontendGuidanceTitle,
  getFrontendReferenceSlug,
  getFrontendQuickstartNavTree,
  getFrontendUsingTheseDocsPath,
} from "../frontend-page-content";
import { loadDoc } from "../docs-render";
import type { NavNode } from "../docs-render";
import { resolveFrontendDocPage } from "../frontend-doc-policy";
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

describe("frontend options", () => {
  it("keeps React as the full docs surface and routes other frontends to their guides", () => {
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
    expect(frontendPathFor("react", "using-these-docs")).toBe("/");
    expect(frontendFromPathname("/vue")).toBe("vue");
    expect(frontendFromPathname("/vue/concepts/architecture")).toBe("vue");
    expect(frontendFromPathname("/react")).toBeNull();
    expect(frontendFromPathname("/frontends/vue")).toBeNull();
    expect(frontendFromPathname("/langgraph-python/quickstart")).toBeNull();
  });

  it("maps picker selections across frontend URL shapes", () => {
    const backendSlugs = ["built-in-agent", "langgraph-python", "mastra"];

    expect(
      frontendPathForCurrentPath("slack", "/vue/concepts/architecture"),
    ).toBe("/slack/concepts/architecture");
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
        "slack",
        "/vue/langgraph-python/concepts/architecture",
        backendSlugs,
      ),
    ).toBe("/slack/langgraph-python/concepts/architecture");
    expect(
      frontendPathForCurrentPath(
        "react",
        "/vue/langgraph-python/concepts/architecture",
        backendSlugs,
      ),
    ).toBe("/langgraph-python/concepts/architecture");
  });

  it("parses and builds two-axis frontend/backend routes", () => {
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
    expect(
      parseFrontendRoutePath("/vue/using-these-docs", backendSlugs),
    ).toEqual({
      frontend: "vue",
      backend: null,
      slugPath: "using-these-docs",
    });
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
  });

  it("maps every non-React frontend to an MDX guide page", () => {
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
    expect(isFrontendEarlyAccess("vue")).toBe(false);
    expect(isFrontendEarlyAccess("react-native")).toBe(false);
    expect(isFrontendEarlyAccess("slack")).toBe(true);
    expect(isFrontendEarlyAccess("teams")).toBe(true);
    expect(loadDoc(FRONTEND_GUIDANCE_CONTENT_SLUG)?.fm.title).toBe(
      "About early access",
    );
    expect(loadDoc(FRONTEND_DOCS_STATUS_CONTENT_SLUG)?.fm.title).toBe(
      "Docs status",
    );
    expect(getFrontendGuidanceContentSlug("vue")).toBe(
      FRONTEND_DOCS_STATUS_CONTENT_SLUG,
    );
    expect(getFrontendGuidanceContentSlug("slack")).toBe(
      FRONTEND_GUIDANCE_CONTENT_SLUG,
    );
    expect(getFrontendGuidanceTitle("vue")).toBe("Docs status");
    expect(getFrontendGuidanceTitle("slack")).toBe("About early access");
    expect(isFrontendEarlyAccess("react")).toBe(false);
  });

  it("routes frontend sidebars to the most specific reference docs available", () => {
    expect(getFrontendReferenceSlug("react-native")).toBe(
      "reference/react-native",
    );
    expect(getFrontendReferenceSlug("slack")).toBe("reference/channels");
    expect(getFrontendReferenceSlug("vue")).toBe("reference");
    expect(getFrontendReferenceSlug("teams")).toBe("reference");
  });

  it("keeps non-React frontend sidebars limited to quickstart and reference links", () => {
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
      "/slack/using-these-docs",
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
    expect(getFrontendQuickstartNavTree("slack")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "section",
          variant: "frontend-docs-upcoming",
          frontendDocsStatus: "early-access",
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

  it("renders frontend docs status copy by frontend availability", () => {
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
    expect(renderNavNameToMarkup(slackUpcoming?.name)).toContain(
      "Slack is currently in early access. The ",
    );
    expect(renderNavNameToMarkup(slackUpcoming?.name)).toContain(
      " guides are ready; more are on the way after early access.",
    );
  });
});
