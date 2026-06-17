import { describe, expect, it } from "vitest";

import {
  FRONTEND_OPTIONS,
  frontendFromPathname,
  frontendPathFor,
  getFrontendOption,
  isFrontendId,
} from "../frontend-options";
import {
  FRONTEND_IN_PROGRESS_CONTENT_SLUG,
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
  getFrontendDocsInProgressSlug,
  getFrontendQuickstartNavTree,
} from "../frontend-page-content";
import { loadDoc } from "../docs-render";
import type { NavNode } from "../docs-render";

function flattenNavTree(tree: NavNode[]): NavNode[] {
  return tree.flatMap((node) =>
    node.type === "group" ? [node, ...flattenNavTree(node.children)] : [node],
  );
}

describe("frontend options", () => {
  it("keeps React as the full docs surface and routes other frontends to quickstarts", () => {
    expect(frontendPathFor("react")).toBe("/");
    expect(frontendPathFor("vue")).toBe("/frontends/vue");
    expect(frontendPathFor("react-native")).toBe("/frontends/react-native");
    expect(frontendFromPathname("/frontends/vue")).toBe("vue");
    expect(frontendFromPathname("/frontends/react")).toBeNull();
    expect(frontendFromPathname("/langgraph-python/quickstart")).toBeNull();
  });

  it("maps every non-React frontend to an MDX quickstart page", () => {
    const nonReactIds = FRONTEND_OPTIONS.filter(
      (option) => option.id !== "react",
    ).map((option) => option.id);

    expect(FRONTEND_PAGE_IDS).toEqual(nonReactIds);
    for (const id of FRONTEND_PAGE_IDS) {
      expect(isFrontendId(id)).toBe(true);
      expect(getFrontendOption(id).name).toBeTruthy();
      expect(getFrontendContentSlug(id)).toBe(`frontends/${id}`);
      expect(getFrontendDocsInProgressSlug(id)).toBe(
        `frontends/${id}/docs-in-progress`,
      );
      expect(loadDoc(getFrontendContentSlug(id))?.fm.title).toBeTruthy();
    }
    expect(loadDoc(FRONTEND_IN_PROGRESS_CONTENT_SLUG)?.fm.title).toBe(
      "Docs in progress",
    );
  });

  it("keeps non-React frontend sidebars focused before shadowing React parallels", () => {
    const navTree = getFrontendQuickstartNavTree("slack");

    expect(navTree.slice(0, 6)).toEqual([
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Quickstart", slug: "frontends/slack" },
      {
        type: "page",
        title: "Docs in progress",
        slug: "frontends/slack/docs-in-progress",
        icon: "lucide/Wrench",
      },
      { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
      {
        type: "page",
        title: "Reference docs",
        slug: "reference",
      },
      {
        type: "page",
        title: "React docs for deeper examples",
        slug: "",
      },
    ]);

    expect(navTree).toContainEqual({
      type: "section",
      title: "React parallels",
      icon: "lucide/RefreshCw",
      variant: "shadow-divider",
    });

    expect(flattenNavTree(navTree)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          title: "Prebuilt Components",
          variant: "shadow",
        }),
      ]),
    );
  });
});
