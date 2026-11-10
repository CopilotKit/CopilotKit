import { describe, it, expect } from "vitest";
import { markdownToChat } from "./markdown.js";

describe("markdownToChat", () => {
  it("converts **bold** to *bold*", () => {
    expect(markdownToChat("**hi**")).toBe("*hi*");
  });
  it("converts markdown links to angle form", () => {
    expect(markdownToChat("[CK](https://copilotkit.ai)")).toBe(
      "<https://copilotkit.ai|CK>",
    );
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

  // ── Fix 1: link scheme allowlist ──────────────────────────────────────────
  it("drops a javascript: link and keeps only the visible text", () => {
    const out = markdownToChat("[click](javascript:alert1)");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<");
    expect(out).toBe("click");
  });
  it("drops a data: link and keeps only the visible text", () => {
    const out = markdownToChat("[x](data:text/html,<script>)");
    expect(out).not.toContain("data:");
    expect(out).toBe("x");
  });
  it("keeps an http:/https: link (regression)", () => {
    expect(markdownToChat("[CK](http://copilotkit.ai)")).toBe(
      "<http://copilotkit.ai|CK>",
    );
    expect(markdownToChat("[CK](https://copilotkit.ai)")).toBe(
      "<https://copilotkit.ai|CK>",
    );
  });
  it("keeps a mailto: link", () => {
    expect(markdownToChat("[mail](mailto:a@b.com)")).toBe(
      "<mailto:a@b.com|mail>",
    );
  });
  it("keeps a relative link (no scheme)", () => {
    expect(markdownToChat("[rel](/path/to/page)")).toBe("</path/to/page|rel>");
  });
  it("keeps balanced parens in a link URL (Wikipedia-style) intact", () => {
    expect(
      markdownToChat("[wiki](https://en.wikipedia.org/wiki/Foo_(bar))"),
    ).toBe("<https://en.wikipedia.org/wiki/Foo_(bar)|wiki>");
  });

  // ── Fix: links are extracted BEFORE the emphasis passes, so `*`/`_`/`~` ──
  // inside a URL is never rewritten as Chat emphasis and the URL stays verbatim.
  it("keeps underscores in a link URL verbatim (not turned into italics)", () => {
    expect(markdownToChat("[doc](https://x.com/path/_foo_/bar)")).toBe(
      "<https://x.com/path/_foo_/bar|doc>",
    );
  });
  it("keeps asterisks in a link URL verbatim (not turned into italics)", () => {
    expect(markdownToChat("[doc](https://x.com/p/*a*/b)")).toBe(
      "<https://x.com/p/*a*/b|doc>",
    );
  });
  it("does not let a `|` in the URL break the chat link (percent-encoded)", () => {
    // The `|` must not be read as the <url|text> label delimiter; it is
    // percent-encoded so the href round-trips intact (no truncation at a=1).
    const out = markdownToChat("[t](https://x.com/?a=1|2)");
    expect(out).toBe("<https://x.com/?a=1%7C2|t>");
    expect(out).not.toContain("a=1|2"); // the raw pipe didn't survive as a delimiter
  });
  it("does not let a `>` in the URL prematurely end the chat link", () => {
    const out = markdownToChat("[t](https://x.com/?a=1>2)");
    expect(out).toBe("<https://x.com/?a=1%3E2|t>");
  });

  // ── Fix 2: sentinel control bytes are stripped from input ─────────────────
  it("strips sentinel control bytes from the input without corrupting prose", () => {
    // A literal \x10 sentinel embedded in user/LLM content must be removed,
    // and the surrounding text preserved, so the code-region machinery isn't
    // confused by a colliding byte.
    const out = markdownToChat("before\x10CODE0\x10after");
    expect(out).not.toContain("\x10");
    expect(out).toBe("beforeCODE0after");
  });
  it("strips \\x11/\\x12 bold sentinels from the input", () => {
    const out = markdownToChat("a\x11b\x12c");
    expect(out).not.toContain("\x11");
    expect(out).not.toContain("\x12");
    expect(out).toBe("abc");
  });
});
