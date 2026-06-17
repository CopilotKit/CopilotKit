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
});
