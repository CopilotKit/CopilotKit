import { describe, expect, it } from "vitest";
import { isDocsExplorePath, isIntelligenceDocsPath } from "../docs-mega-menu";

describe("isIntelligenceDocsPath", () => {
  it("matches Intelligence docs on the root and framework surfaces", () => {
    expect(isIntelligenceDocsPath("/intelligence/overview")).toBe(true);
    expect(isIntelligenceDocsPath("/intelligence/self-hosting")).toBe(true);
    expect(
      isIntelligenceDocsPath("/langgraph-python/intelligence/overview"),
    ).toBe(true);
    expect(isIntelligenceDocsPath("/premium/overview")).toBe(true);
    expect(isIntelligenceDocsPath("/quickstart")).toBe(false);
    expect(isIntelligenceDocsPath("/reference")).toBe(false);
  });
});

describe("isDocsExplorePath", () => {
  it("treats Intelligence and guide pages as Docs", () => {
    expect(isDocsExplorePath("/")).toBe(true);
    expect(isDocsExplorePath("/quickstart")).toBe(true);
    expect(isDocsExplorePath("/reference")).toBe(false);
    expect(isDocsExplorePath("/reference/hooks/useAgent")).toBe(false);
    expect(isDocsExplorePath("/cookbook")).toBe(false);
    expect(isDocsExplorePath("/intelligence/overview")).toBe(true);
    expect(isDocsExplorePath("/premium/overview")).toBe(true);
  });
});
