import { describe, expect, it } from "vitest";

import {
  FRONTEND_OPTIONS,
  frontendFromPathname,
  frontendPathFor,
  getFrontendOption,
  isFrontendId,
} from "../frontend-options";
import {
  FRONTEND_GUIDANCE_CONTENT_SLUG,
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
  getFrontendReferenceSlug,
  getFrontendUsingTheseDocsPath,
  getFrontendQuickstartNavTree,
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

describe("frontend options", () => {
  it("keeps React as the full docs surface and routes other frontends to their guides", () => {
    expect(frontendPathFor("react")).toBe("/");
    expect(frontendPathFor("vue")).toBe("/frontends/vue");
    expect(frontendPathFor("react-native")).toBe("/frontends/react-native");
    expect(frontendFromPathname("/frontends/vue")).toBe("vue");
    expect(frontendFromPathname("/frontends/react")).toBeNull();
    expect(frontendFromPathname("/langgraph-python/quickstart")).toBeNull();
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
      expect(getFrontendUsingTheseDocsPath(id)).toBe(
        `/frontends/${id}/using-these-docs`,
      );
      expect(loadDoc(getFrontendContentSlug(id))?.fm.title).toBeTruthy();
    }
    expect(loadDoc(FRONTEND_GUIDANCE_CONTENT_SLUG)?.fm.title).toBe(
      "Using these docs",
    );
  });

  it("routes frontend sidebars to the most specific reference docs available", () => {
    expect(getFrontendReferenceSlug("react-native")).toBe(
      "reference/react-native",
    );
    expect(getFrontendReferenceSlug("slack")).toBe("reference/bot");
    expect(getFrontendReferenceSlug("vue")).toBe("reference");
    expect(getFrontendReferenceSlug("teams")).toBe("reference");
  });

  it("keeps non-React frontend sidebars focused before proxying React docs", () => {
    const navTree = getFrontendQuickstartNavTree("slack");
    const flattenedNavTree = flattenNavTree(navTree);

    expect(navTree.slice(0, 3)).toEqual([
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Quickstart", slug: "" },
      {
        type: "page",
        title: "Using these docs 🏗️",
        slug: "using-these-docs",
        icon: "lucide/Wrench",
      },
    ]);

    expect(flattenedNavTree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "section",
          title: "Concepts",
        }),
        expect.objectContaining({
          type: "page",
          title: "Architecture",
          slug: "concepts/architecture",
        }),
      ]),
    );

    expect(
      flattenedNavTree.find(
        (node) => node.type === "section" && node.title === "Concepts",
      )?.variant,
    ).toBeUndefined();
    expect(
      flattenedNavTree.find(
        (node) => node.type === "page" && node.slug === "concepts/architecture",
      )?.variant,
    ).toBeUndefined();
    expect(
      flattenedNavTree.find(
        (node) => node.type === "page" && node.slug === "concepts/which-hook",
      ),
    ).toBeUndefined();

    expect(navTree).toEqual(
      expect.arrayContaining([
        { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
        {
          type: "page",
          title: "Reference docs",
          slug: "reference/bot",
          href: "/reference/bot",
        },
      ]),
    );

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

    expect(navTree).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "section",
          title: "React docs",
        }),
      ]),
    );

    expect(flattenNavTree(navTree)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          title: "React docs for deeper examples",
        }),
      ]),
    );

    expect(flattenedNavTree).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variant: "shadow-note",
        }),
        expect.objectContaining({
          variant: "shadow",
        }),
        expect.objectContaining({
          variant: "shadow-divider",
        }),
      ]),
    );

    expect(
      flattenedNavTree.find(
        (node) =>
          node.variant === "react-docs-proxy" &&
          node.type === "section" &&
          /^(get|getting) started$/i.test(node.title),
      ),
    ).toBeUndefined();

    const proxiedPageTitles = flattenedNavTree
      .filter(
        (node) => node.type === "page" && node.variant === "react-docs-proxy",
      )
      .map((node) => node.title);
    expect(proxiedPageTitles).not.toEqual(
      expect.arrayContaining([
        "Introduction",
        "Quickstart",
        "Build with agents",
        "Architecture",
        "Generative UI Overview",
        "Which Hook for Which Job",
      ]),
    );

    expect(flattenedNavTree).toEqual(
      expect.arrayContaining([
        { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
        expect.objectContaining({
          type: "page",
          title: "Prebuilt Components",
          variant: "react-docs-proxy",
          href: "/prebuilt-components",
        }),
        expect.objectContaining({
          type: "group",
          variant: "react-docs-proxy",
        }),
      ]),
    );

    const pageUrls = collectPageUrls(
      navTreeToPageTree(navTree, "/frontends/slack"),
    );
    expect(pageUrls).toEqual(
      expect.arrayContaining([
        "/frontends/slack",
        "/frontends/slack/using-these-docs",
        "/frontends/slack/concepts/architecture",
        "/frontends/slack/agentic-protocols",
        "/frontends/slack/agentic-protocols/ag-ui",
        "/reference/bot",
        "/prebuilt-components",
      ]),
    );
    expect(pageUrls).not.toEqual(
      expect.arrayContaining([
        "/concepts/architecture",
        "/frontends/slack/concepts/which-hook",
        "/frontends/slack/prebuilt-components",
      ]),
    );

    expect(resolveFrontendDocPage("slack", "agentic-protocols")).toEqual(
      expect.objectContaining({
        status: "found",
        slugPath: "agentic-protocols",
        contentSlugPath: "agentic-protocols",
        canonicalPath: "/agentic-protocols",
      }),
    );
  });
});
