import { describe, it, expect } from "vitest";
import { telegramHtml, escapeHtml } from "../telegram-html.js";
import { stripHtml } from "../format-fallback.js";

describe("escapeHtml", () => {
  it("escapes & < >", () => {
    expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
  it('escapes " to &quot;', () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });
});

describe("telegramHtml", () => {
  it("escapes HTML-special characters in plain text", () => {
    expect(telegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
  });
  it("**bold** → <b>", () => {
    expect(telegramHtml("**hi**")).toBe("<b>hi</b>");
  });
  it("*italic* → <i>", () => {
    expect(telegramHtml("*hi*")).toBe("<i>hi</i>");
  });
  it("~~strike~~ → <s>", () => {
    expect(telegramHtml("~~hi~~")).toBe("<s>hi</s>");
  });
  it("inline `code` → <code> (contents escaped, not re-parsed)", () => {
    expect(telegramHtml("`a < b`")).toBe("<code>a &lt; b</code>");
  });
  it("fenced code → <pre>", () => {
    expect(telegramHtml("```\nx<y\n```")).toBe("<pre>x&lt;y</pre>");
  });
  it("[t](u) → <a href>", () => {
    expect(telegramHtml("[go](https://x.io)")).toBe(
      '<a href="https://x.io">go</a>',
    );
  });
  it("escapes & in link URLs exactly once (no double-escape)", () => {
    expect(telegramHtml("[go](https://x.io?a=1&b=2)")).toBe(
      '<a href="https://x.io?a=1&amp;b=2">go</a>',
    );
  });
  it("heading → bold line", () => {
    expect(telegramHtml("# Title")).toBe("<b>Title</b>");
  });
  it("bullet → • prefix", () => {
    expect(telegramHtml("- item")).toBe("•  item");
  });

  // Regression: URL underscores must not be converted to italics (Bug 1)
  it("link URL with underscores is not mangled by italic pass", () => {
    expect(telegramHtml("[doc](https://x.com/a_b_c)")).toBe(
      '<a href="https://x.com/a_b_c">doc</a>',
    );
  });

  // Regression: double-quote in URL must be escaped to &quot; to prevent href attribute breakout
  it('link URL containing " has the quote escaped to &quot; in href', () => {
    expect(telegramHtml('[x](http://e.com/a"b)')).toBe(
      '<a href="http://e.com/a&quot;b">x</a>',
    );
  });
});

describe("stripHtml", () => {
  // Regression: &amp;lt; must unescape to &lt;, not < (Bug 2 — unescape &amp; last)
  it("&amp;lt; unescapes to the literal text &lt;, not <", () => {
    expect(stripHtml("&amp;lt;")).toBe("&lt;");
  });
});
