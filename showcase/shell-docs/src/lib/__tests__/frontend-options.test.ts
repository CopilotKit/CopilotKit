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
});
