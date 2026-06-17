import { describe, expect, it } from "vitest";

import {
  FRONTEND_OPTIONS,
  frontendFromPathname,
  frontendPathFor,
  getFrontendOption,
  isFrontendId,
} from "../frontend-options";
import {
  FRONTEND_PAGE_CONTENT,
  FRONTEND_PAGE_IDS,
  getFrontendPageContent,
  getFrontendQuickstartNavTree,
} from "../frontend-page-content";

describe("frontend options", () => {
  it("keeps React as the full docs surface and routes other frontends to quickstarts", () => {
    expect(frontendPathFor("react")).toBe("/");
    expect(frontendPathFor("vue")).toBe("/frontends/vue");
    expect(frontendPathFor("react-native")).toBe("/frontends/react-native");
    expect(frontendFromPathname("/frontends/vue")).toBe("vue");
    expect(frontendFromPathname("/frontends/react")).toBeNull();
    expect(frontendFromPathname("/langgraph-python/quickstart")).toBeNull();
  });

  it("has a single quickstart page for every non-React frontend", () => {
    const nonReactIds = FRONTEND_OPTIONS.filter(
      (option) => option.id !== "react",
    ).map((option) => option.id);

    expect(FRONTEND_PAGE_IDS).toEqual(nonReactIds);
    for (const id of FRONTEND_PAGE_IDS) {
      expect(isFrontendId(id)).toBe(true);
      expect(getFrontendOption(id).name).toBeTruthy();
      expect(getFrontendPageContent(id)).toBe(FRONTEND_PAGE_CONTENT[id]);
      expect(FRONTEND_PAGE_CONTENT[id].steps.length).toBeGreaterThanOrEqual(3);
      expect(FRONTEND_PAGE_CONTENT[id].references.length).toBeGreaterThan(0);
    }
  });

  it("keeps non-React frontend sidebars focused on the current quickstart", () => {
    expect(getFrontendQuickstartNavTree("slack")).toEqual([
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Quickstart", slug: "frontends/slack" },
      { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
      {
        type: "page",
        title: "React docs for deeper examples",
        slug: "",
      },
    ]);
  });
});
