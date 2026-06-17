import { describe, it, expect } from "vitest";
import { markdownToChat } from "./markdown.js";

describe("markdownToChat", () => {
  it("converts **bold** to *bold*", () => {
    expect(markdownToChat("**hi**")).toBe("*hi*");
  });
  it("converts markdown links to angle form", () => {
    expect(markdownToChat("[CK](https://copilotkit.ai)")).toBe("<https://copilotkit.ai|CK>");
  });
  it("leaves fenced code untouched", () => {
    expect(markdownToChat("```\ncode\n```")).toContain("```");
  });
  it("preserves literal CODE<n> in prose when no code regions exist", () => {
    // Regression: the code-region placeholder must use a collision-proof
    // sentinel, not a human-typeable token, so prose containing "CODE0"
    // is not deleted or replaced during restore.
    expect(markdownToChat("refer to CODE0 here")).toBe("refer to CODE0 here");
  });
  it("preserves literal CODE<n> alongside real code regions", () => {
    const out = markdownToChat("see `x` and refer to CODE0");
    expect(out).toContain("`x`");
    expect(out).toContain("CODE0");
  });
});
