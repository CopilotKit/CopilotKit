import { describe, expect, it } from "vitest";
import { resolveLlmTextSurface } from "./llm-text-surface";

describe("resolveLlmTextSurface", () => {
  it("names the two llms.txt convention endpoints separately", () => {
    expect(resolveLlmTextSurface("/llms.txt")).toBe("llms_index");
    expect(resolveLlmTextSurface("/llms-full.txt")).toBe("llms_full");
  });

  it("treats every per-page raw Markdown URL as one surface", () => {
    expect(resolveLlmTextSurface("/learning.md")).toBe("page_markdown");
    expect(resolveLlmTextSurface("/learning.mdx")).toBe("page_markdown");
    expect(resolveLlmTextSurface("/langgraph-python/quickstart.md")).toBe(
      "page_markdown",
    );
    expect(
      resolveLlmTextSurface("/reference/hooks/use-copilot-action.md"),
    ).toBe("page_markdown");
  });

  it("does not claim an ordinary docs page", () => {
    expect(resolveLlmTextSurface("/quickstart")).toBeNull();
    expect(resolveLlmTextSurface("/")).toBeNull();
    // The substring appears mid-path, which is not a raw Markdown request.
    expect(resolveLlmTextSurface("/guides/.md-authoring")).toBeNull();
    expect(resolveLlmTextSurface("/llms.txt.html")).toBeNull();
  });

  it("does not claim the static text files the matcher already excludes", () => {
    expect(resolveLlmTextSurface("/robots.txt")).toBeNull();
    expect(resolveLlmTextSurface("/sitemap.xml")).toBeNull();
  });
});
