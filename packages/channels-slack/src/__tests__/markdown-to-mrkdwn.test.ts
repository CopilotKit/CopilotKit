import { describe, it, expect } from "vitest";
import { markdownToMrkdwn } from "../markdown-to-mrkdwn.js";

describe("markdownToMrkdwn", () => {
  it("**bold** → *bold*", () => {
    expect(markdownToMrkdwn("hello **world**!")).toBe("hello *world*!");
  });

  it("__bold__ also → *bold*", () => {
    expect(markdownToMrkdwn("__strong__ text")).toBe("*strong* text");
  });

  it("*italic* → _italic_", () => {
    expect(markdownToMrkdwn("here is *emphasised* text")).toBe(
      "here is _emphasised_ text",
    );
  });

  it("~~strike~~ → ~strike~", () => {
    expect(markdownToMrkdwn("~~gone~~")).toBe("~gone~");
  });

  it("# heading → *heading*", () => {
    expect(markdownToMrkdwn("# Title")).toBe("*Title*");
    expect(markdownToMrkdwn("### Sub")).toBe("*Sub*");
  });

  it("[text](url) → <url|text>", () => {
    expect(markdownToMrkdwn("see [docs](https://x.com/d)")).toBe(
      "see <https://x.com/d|docs>",
    );
  });

  it("bullet markers (- * +) → •", () => {
    const input = "- one\n* two\n+ three";
    const expected = "•  one\n•  two\n•  three";
    expect(markdownToMrkdwn(input)).toBe(expected);
  });

  it("indented bullets keep their indent", () => {
    expect(markdownToMrkdwn("  - nested")).toBe("  •  nested");
  });

  it("does NOT touch contents of fenced code blocks", () => {
    const md = "```\n**not bold here**\n- not a bullet\n```";
    // body unchanged because it's inside a fence
    expect(markdownToMrkdwn(md)).toBe(md);
  });

  it("does NOT touch contents of inline backticks", () => {
    expect(markdownToMrkdwn("use `**stars**` here")).toBe(
      "use `**stars**` here",
    );
  });

  it("wraps GFM tables in a code fence so they render in monospace", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |\n";
    const out = markdownToMrkdwn(input);
    expect(out.startsWith("```")).toBe(true);
    expect(out).toContain("| a | b |");
    expect(out).toContain("| 1 | 2 |");
    expect(out.trim().endsWith("```")).toBe(true);
  });

  it("aligns table columns so monospace reads cleanly (no pipe-soup)", () => {
    const input =
      "| name | role |\n|---|---|\n| LangGraph | Framework. |\n| AG-UI | Protocol. |\n";
    const out = markdownToMrkdwn(input);
    // Drop the separator row (no visual value in monospace).
    expect(out).not.toContain("|---|");
    // Each rendered data row should have the SAME line length now that
    // columns are padded.
    const dataLines = out
      .split("\n")
      .filter((l) => l.startsWith("|") && l.endsWith("|"));
    expect(dataLines.length).toBe(3); // header + 2 data
    const lens = dataLines.map((l) => l.length);
    expect(new Set(lens).size).toBe(1); // all the same length
  });

  it("aligned table preserves cell contents", () => {
    const input = "| col1 | col2 |\n|---|---|\n| a | b |\n";
    const out = markdownToMrkdwn(input);
    expect(out).toContain("col1");
    expect(out).toContain("col2");
    expect(out).toContain(" a "); // padded but content preserved
    expect(out).toContain(" b ");
  });

  it("translates a paragraph with mixed formatting", () => {
    const input =
      "**Hello** — see [docs](https://x.com) and try:\n- *fast* mode\n- **safe** mode";
    const out = markdownToMrkdwn(input);
    expect(out).toBe(
      "*Hello* — see <https://x.com|docs> and try:\n•  _fast_ mode\n•  *safe* mode",
    );
  });

  it("is a no-op for plain text", () => {
    expect(markdownToMrkdwn("just plain words 123")).toBe(
      "just plain words 123",
    );
  });

  it("is a no-op for the empty string", () => {
    expect(markdownToMrkdwn("")).toBe("");
  });
});
