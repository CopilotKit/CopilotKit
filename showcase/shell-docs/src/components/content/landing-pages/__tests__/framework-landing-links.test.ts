import { describe, expect, it } from "vitest";
import { frameworkLandingHref } from "../framework-overview";

describe("framework landing links", () => {
  it.each([
    "/threads",
    "/threads#replay",
    "/threads?tab=setup",
    "/threads-persistence",
    "/learning",
    "/intelligence/memories",
  ])("keeps %s in the selected Angular backend", (href) => {
    expect(
      frameworkLandingHref(
        href,
        "langgraph",
        "langgraph-fastapi",
        "/angular/langgraph-fastapi",
      ),
    ).toBe(`/angular/langgraph-fastapi${href}`);
  });
  it("maps the authored alias to the active variant", () => {
    expect(
      frameworkLandingHref(
        "/langgraph/quickstart",
        "langgraph",
        "langgraph-typescript",
      ),
    ).toBe("/langgraph-typescript/quickstart");
  });
  it.each([
    "https://example.com/threads",
    "//example.com/threads",
    "/cookbook",
    "/mastra/quickstart",
  ])("preserves explicit unrelated destinations: %s", (href) => {
    expect(frameworkLandingHref(href, "langgraph", "langgraph-fastapi")).toBe(
      href,
    );
  });
});
