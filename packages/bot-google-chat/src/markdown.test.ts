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

  // Headings: the whole line becomes a single bold span. Inline bold inside a
  // heading must not produce nested/unbalanced asterisks.
  it("converts a heading whose entire text is bold to a single bold span", () => {
    expect(markdownToChat("# **Important**")).toBe("*Important*");
  });
  it("converts a heading with inline bold to a single bold span", () => {
    expect(markdownToChat("## Step **1** done")).toBe("*Step 1 done*");
  });
  it("converts a plain heading to a single bold span", () => {
    expect(markdownToChat("# Plain Heading")).toBe("*Plain Heading*");
  });

  it("converts *italic* to _italic_", () => {
    expect(markdownToChat("*x*")).toBe("_x_");
  });
  it("converts ~~strike~~ to ~strike~", () => {
    expect(markdownToChat("~~x~~")).toBe("~x~");
  });
  it("converts a bullet marker to •  ", () => {
    expect(markdownToChat("- x")).toBe("•  x");
  });
});
