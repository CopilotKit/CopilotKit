// packages/channels-discord/src/markdown.test.ts
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

  it("leaves prose containing a stray pipe alone (no false-positive fence)", () => {
    const md = "Use the `a | b` operator.\nIt is a bitwise or.";
    expect(discordMarkdown(md)).toBe(md);
  });

  it("does not fence a one-row pseudo-table without a matching separator", () => {
    const md = "| just | one | row |\nsome following prose";
    expect(discordMarkdown(md)).toBe(md);
  });

  it("does not wrap when the separator column count mismatches the header", () => {
    // Header has 2 columns, separator has 3 — not a real GFM table.
    const md = "| A | B |\n| - | - | - |\n| 1 | 2 |";
    expect(discordMarkdown(md)).toBe(md);
  });

  it("detects and wraps a table whose cell contains an escaped pipe", () => {
    // Header has two cells: "A \| B" (an escaped pipe inside one cell) and "C".
    // A naive split on every `|` would count three cells and fail to match the
    // two-column separator, leaving the table unwrapped.
    const md = ["| A \\| B | C |", "| - | - |", "| 1 | 2 |"].join("\n");
    const out = discordMarkdown(md);
    expect(out.startsWith("```")).toBe(true);
    expect((out.match(/```/g) ?? []).length).toBe(2);
  });

  it("does not double-fence a table already inside a model fence", () => {
    const md = ["```", "| A | B |", "| - | - |", "| 1 | 2 |", "```"].join("\n");
    const out = discordMarkdown(md);
    // Exactly the opening + closing fence — no extra inner pair.
    expect((out.match(/```/g) ?? []).length).toBe(2);
    expect(out).toBe(md);
  });
});
