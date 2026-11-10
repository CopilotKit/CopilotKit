import { describe, expect, it } from "vitest";
import {
  extractReplyText,
  htmlToText,
  stripHtmlQuote,
  stripTextQuote,
} from "../quote.js";

describe("stripTextQuote", () => {
  it("cuts at a Gmail-style attribution line", () => {
    const text = [
      "Yes, please go ahead.",
      "",
      "On Mon, Nov 10, 2026 at 9:00 AM Support <support@example.com> wrote:",
      "> Shall I issue the refund?",
    ].join("\n");
    expect(stripTextQuote(text)).toBe("Yes, please go ahead.");
  });

  it("cuts at an attribution wrapped over two lines", () => {
    const text = [
      "Thanks!",
      "On Mon, Nov 10, 2026 at 9:00 AM Support",
      "<support@example.com> wrote:",
      "> old",
    ].join("\n");
    expect(stripTextQuote(text)).toBe("Thanks!");
  });

  it("cuts at an Outlook header block and at Original Message separators", () => {
    expect(
      stripTextQuote(
        "New text\r\n\r\nFrom: Support <s@example.com>\r\nSent: Monday\r\nSubject: x\r\n\r\nold",
      ),
    ).toBe("New text");
    expect(stripTextQuote("New text\n-----Original Message-----\nold")).toBe(
      "New text",
    );
  });

  it("keeps a line that only starts with From: when no header block follows", () => {
    expect(stripTextQuote("From: my side, this is fine.\nThanks")).toBe(
      "From: my side, this is fine.\nThanks",
    );
  });

  it("drops the signature and trailing quoted lines", () => {
    expect(stripTextQuote("Hello\n\n-- \nAnn Lee\nCEO")).toBe("Hello");
    expect(stripTextQuote("Hello\n> quoted\n> more")).toBe("Hello");
  });

  it("keeps quotes between new text (bottom-posting)", () => {
    expect(stripTextQuote("> question one\nanswer one")).toBe(
      "> question one\nanswer one",
    );
  });

  it("handles other languages' attributions", () => {
    expect(
      stripTextQuote(
        "Danke\nAm 10.11.2026 um 09:00 schrieb Support <s@x.com>:\n> alt",
      ),
    ).toBe("Danke");
  });
});

describe("HTML bodies", () => {
  it("drops the Gmail quote block", () => {
    const html =
      '<div dir="ltr">Sounds good</div><br><div class="gmail_quote"><div>On Mon wrote:</div><blockquote>old</blockquote></div>';
    expect(stripHtmlQuote(html)).toBe('<div dir="ltr">Sounds good</div><br>');
  });

  it("drops an Apple Mail cite blockquote", () => {
    expect(
      stripHtmlQuote('<p>Yes</p><blockquote type="cite">old</blockquote>'),
    ).toBe("<p>Yes</p>");
  });

  it("converts HTML to text with links, lists, and entities", () => {
    const text = htmlToText(
      '<html><head><style>p{}</style></head><body><p>Hi &amp; welcome&nbsp;back</p><ul><li>one</li><li>two</li></ul><p>See <a href="https://example.com/x">the docs</a>.</p><script>alert(1)</script></body></html>',
    );
    expect(text).toBe(
      "Hi & welcome back\n\n- one\n- two\n\nSee the docs (https://example.com/x).",
    );
  });

  it("prefers the text part and falls back to HTML", () => {
    expect(
      extractReplyText({ text: "plain\n> old", html: "<p>html</p>" }),
    ).toBe("plain");
    expect(
      extractReplyText({
        text: null,
        html: '<div>From html</div><div class="gmail_quote">old</div>',
      }),
    ).toBe("From html");
    expect(extractReplyText({ text: "  ", html: null })).toBe("");
  });
});
