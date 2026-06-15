// packages/bot-discord/src/markdown.test.ts
import { describe, it, expect } from "vitest";
import { discordMarkdown } from "./markdown.js";

describe("discordMarkdown", () => {
  it("passes ordinary markdown through unchanged", () => {
    const md = "**bold** _italic_ `code`\n# Heading\n- a\n- b";
    expect(discordMarkdown(md)).toBe(md);
  });

  it("wraps a GFM table in a code fence (Discord can't render tables)", () => {
    const md = ["| A | B |", "| - | - |", "| 1 | 2 |"].join("\n");
    const out = discordMarkdown(md);
    expect(out).toContain("```");
    expect(out).toContain("A");
    expect(out).toContain("1");
    // The original pipe-table syntax must be inside a fence, not left raw.
    expect(out.startsWith("```")).toBe(true);
  });
});
