import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../parse";

describe("parseMarkdown", () => {
  it("parses a heading into a heading token", () => {
    const tokens = parseMarkdown("# Hello");
    expect(tokens[0]).toMatchObject({ type: "heading", depth: 1 });
  });

  it("parses GFM tables", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const tokens = parseMarkdown(md);
    expect(tokens.some((t) => t.type === "table")).toBe(true);
  });

  it("parses fenced code with a language", () => {
    const tokens = parseMarkdown("```ts\nconst x = 1;\n```");
    const code = tokens.find((t) => t.type === "code") as { lang?: string; text: string };
    expect(code).toBeDefined();
    expect(code.lang).toBe("ts");
    expect(code.text).toContain("const x = 1;");
  });

  it("completes partial markdown before parsing (streaming safety)", () => {
    const tokens = parseMarkdown("**bold");
    expect(tokens[0]?.type).toBe("paragraph");
  });

  it("can skip completion when complete:false", () => {
    const tokens = parseMarkdown("**bold", { complete: false });
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.links).toBeDefined();
  });

  it("returns an empty token list for empty input", () => {
    const tokens = parseMarkdown("");
    expect(tokens).toHaveLength(0);
    expect(tokens.links).toBeDefined();
  });

  it("parses unordered lists", () => {
    const tokens = parseMarkdown("- one\n- two");
    expect(tokens.some((t) => t.type === "list")).toBe(true);
  });

  it("parses blockquotes", () => {
    const tokens = parseMarkdown("> quoted");
    expect(tokens.some((t) => t.type === "blockquote")).toBe(true);
  });
});
