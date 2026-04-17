import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

/**
 * Verifies the rehype-raw + rehype-sanitize pipeline used by
 * packages/react-ui/src/components/chat/Markdown.tsx to fix #3938 (XSS).
 *
 * Mirrors the plugin order the Markdown component passes to react-markdown.
 * If this order changes in Markdown.tsx, update here too.
 */

async function renderMarkdown(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath, { singleDollarTextMath: false })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(source);
  return String(file);
}

describe("Markdown XSS sanitization (fixes #3938)", () => {
  it("strips <script> tags from raw HTML", async () => {
    const html = await renderMarkdown("<script>window.__xss=1</script>");
    expect(html).not.toContain("<script");
  });

  it("strips onerror handler from <img>", async () => {
    const html = await renderMarkdown('<img src="x" onerror="window.__xss=1">');
    expect(html).not.toMatch(/onerror/i);
  });

  it("strips <iframe> tags", async () => {
    const html = await renderMarkdown(
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    );
    expect(html).not.toContain("<iframe");
  });

  it("strips onload handler from <svg>", async () => {
    const html = await renderMarkdown('<svg onload="window.__xss=1"></svg>');
    expect(html).not.toMatch(/onload/i);
  });

  it("strips javascript: protocol from links", async () => {
    const html = await renderMarkdown(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(html).not.toMatch(/href=["']javascript:/i);
  });

  it("strips inline <form> elements", async () => {
    const html = await renderMarkdown('<form action="/evil"><input></form>');
    expect(html).not.toContain("<form");
  });

  it("strips <object> elements", async () => {
    const html = await renderMarkdown('<object data="evil.swf"></object>');
    expect(html).not.toContain("<object");
  });

  it("strips inline event handlers on arbitrary elements", async () => {
    const html = await renderMarkdown(
      '<div onmouseover="window.__xss=1">hover me</div>',
    );
    expect(html).not.toMatch(/onmouseover/i);
  });

  it("preserves safe Markdown formatting", async () => {
    const html = await renderMarkdown(
      "**bold** and [link](https://example.com) and `code`",
    );
    expect(html).toContain("<strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<code>");
  });

  it("preserves Markdown tables from remark-gfm", async () => {
    const html = await renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  it("preserves safe inline HTML like <br>", async () => {
    const html = await renderMarkdown("line one<br>line two");
    expect(html).toContain("<br>");
  });
});
