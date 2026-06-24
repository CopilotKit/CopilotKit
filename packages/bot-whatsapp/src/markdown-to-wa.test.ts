import { describe, it, expect } from "vitest";
import { markdownToWhatsApp } from "./markdown-to-wa.js";

describe("markdownToWhatsApp", () => {
  it("converts **bold** to *bold*", () => {
    expect(markdownToWhatsApp("**hi**")).toBe("*hi*");
    expect(markdownToWhatsApp("__hi__")).toBe("*hi*");
  });

  it("keeps single-underscore/asterisk italic as _italic_", () => {
    expect(markdownToWhatsApp("*hi*")).toBe("_hi_");
    expect(markdownToWhatsApp("_hi_")).toBe("_hi_");
  });

  it("converts ~~strike~~ to ~strike~", () => {
    expect(markdownToWhatsApp("~~gone~~")).toBe("~gone~");
  });

  it("renders a link as 'text (url)'", () => {
    expect(markdownToWhatsApp("[docs](https://x.io)")).toBe(
      "docs (https://x.io)",
    );
  });

  it("strips ATX headers to plain bold lines", () => {
    expect(markdownToWhatsApp("# Title")).toBe("*Title*");
    expect(markdownToWhatsApp("### Sub")).toBe("*Sub*");
  });

  it("leaves fenced code blocks intact", () => {
    const src = "```\ncode *not bold*\n```";
    expect(markdownToWhatsApp(src)).toBe("```\ncode *not bold*\n```");
  });

  it("preserves inline code without transforming inside it", () => {
    expect(markdownToWhatsApp("`a**b**`")).toBe("`a**b**`");
  });
});
