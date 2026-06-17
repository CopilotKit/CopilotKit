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
  getFrontendUsingTheseDocsSlug,
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
      expect(getFrontendUsingTheseDocsSlug(id)).toBe(
        `frontends/${id}/using-these-docs`,
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

  it("keeps non-React frontend sidebars focused before shadowing React docs", () => {
    const navTree = getFrontendQuickstartNavTree("slack");

    expect(navTree.slice(0, 5)).toEqual([
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Quickstart", slug: "frontends/slack" },
      {
        type: "page",
        title: "Using these docs 🏗️",
        slug: "frontends/slack/using-these-docs",
        icon: "lucide/Wrench",
      },
      { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
      {
        type: "page",
        title: "Reference docs",
        slug: "reference/bot",
      },
    ]);

    expect(flattenNavTree(navTree)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          title: "React docs for deeper examples",
        }),
      ]),
    );

    expect(navTree).toContainEqual({
      type: "section",
      title: "React docs",
      icon: "custom/react",
      variant: "shadow-divider",
    });

    expect(flattenNavTree(navTree)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "page",
          slug: "frontends/slack/using-these-docs",
          variant: "shadow-note",
        }),
        expect.objectContaining({
          type: "page",
          title: "Prebuilt Components",
          variant: "shadow",
        }),
      ]),
    );
  });
});
