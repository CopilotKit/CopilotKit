import { describe, expect, it } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { markdownToHtml } from "../markdown.js";
import { renderEmail } from "../render.js";

const n = (type: string, props: Record<string, unknown> = {}): ChannelNode => ({
  type,
  props,
});
const text = (value: string) => n("text", { value });

const card = [
  n("message", {
    accent: "#27AE60",
    children: [
      n("header", { children: [text("Deploy <prod>")] }),
      n("section", { children: [text("Ready to **ship**?")] }),
      n("fields", {
        children: [n("field", { label: "Env", children: [text("prod")] })],
      }),
      n("actions", {
        children: [
          n("button", {
            onClick: { id: "ck:approve" },
            value: { ok: true },
            style: "primary",
            children: [text("Approve")],
          }),
          n("button", {
            url: "https://example.com/logs",
            children: [text("Logs")],
          }),
          n("button", { url: "javascript:alert(1)", children: [text("Bad")] }),
        ],
      }),
    ],
  }),
];

describe("renderEmail", () => {
  it("renders handler buttons as signed links when links are on", () => {
    const seen: unknown[] = [];
    const body = renderEmail(card, {
      link: (control) => {
        seen.push(control);
        return `https://bot.test/gmail?a=${control.id}`;
      },
    });
    expect(seen).toEqual([
      { id: "ck:approve", label: "Approve", value: { ok: true } },
    ]);
    expect(body.html).toContain('href="https://bot.test/gmail?a=ck:approve"');
    expect(body.html).toContain(">Approve</a>");
    expect(body.text).toContain("Approve: https://bot.test/gmail?a=ck:approve");
  });

  it("keeps only the label of a handler button when links are off", () => {
    const body = renderEmail(card);
    expect(body.html).not.toContain("ck:approve");
    expect(body.html).toMatch(/<span[^>]*>Approve<\/span>/);
    expect(body.text).toContain("[Approve]");
  });

  it("always renders link buttons, and drops unsafe URLs", () => {
    const body = renderEmail(card);
    expect(body.html).toContain('href="https://example.com/logs"');
    expect(body.text).toContain("Logs: https://example.com/logs");
    expect(body.html).not.toContain("javascript:");
    expect(body.text).toContain("[Bad]");
  });

  it("escapes text and renders Markdown in sections", () => {
    const body = renderEmail(card);
    expect(body.html).toContain("Deploy &lt;prod&gt;");
    expect(body.html).toContain("<strong>ship</strong>");
    expect(body.html).toContain("border-left:4px solid #27AE60");
    expect(body.html).toContain("<strong>Env:</strong> prod");
    expect(body.text).toContain("Deploy <prod>");
    expect(body.text).toContain("Env: prod");
  });

  it("renders select options as links, one per option", () => {
    const body = renderEmail(
      [
        n("select", {
          onSelect: { id: "ck:size" },
          placeholder: "Pick a size",
          options: [
            { label: "Small", value: "s" },
            { label: "Large", value: "l" },
          ],
        }),
      ],
      { link: (c) => `https://bot.test/?a=${c.id}-${String(c.value)}` },
    );
    expect(body.html).toContain("Pick a size");
    expect(body.html).toContain('href="https://bot.test/?a=ck:size-s"');
    expect(body.html).toContain('href="https://bot.test/?a=ck:size-l"');
    expect(body.text).toContain("- Large: https://bot.test/?a=ck:size-l");
  });

  it("renders tables and charts as HTML tables", () => {
    const body = renderEmail([
      n("table", {
        columns: [{ header: "Name" }, { header: "Score" }],
        children: [
          n("row", {
            children: [
              n("cell", { children: [text("Ana")] }),
              n("cell", { children: [text("9")] }),
            ],
          }),
        ],
      }),
      n("chart", { title: "Sales", data: [{ label: "Q1", value: 3 }] }),
    ]);
    expect(body.html).toMatch(/<th[^>]*>Name<\/th>/);
    expect(body.html).toMatch(/<td[^>]*>Ana<\/td>/);
    expect(body.text).toContain("Name | Score\nAna | 9");
    expect(body.text).toContain("Sales\n\nQ1: 3");
  });

  it("drops inputs and raw payloads, and shows a Render summary", () => {
    const body = renderEmail([
      n("input", { onSubmit: { id: "ck:x" }, placeholder: "Type" }),
      n("raw", { payload: { blocks: [] } }),
      n("render", { alt: "A chart of sales" }),
    ]);
    expect(body.text).toBe("A chart of sales");
    expect(body.html).not.toContain("ck:x");
  });
});

describe("markdownToHtml", () => {
  it("renders the common Markdown an agent writes", () => {
    const html = markdownToHtml(
      [
        "# Title",
        "",
        "Some *em* and `code` and [a link](https://example.com).",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "",
        "> quoted",
        "",
        "```",
        "<b>raw</b>",
        "```",
      ].join("\n"),
    );
    expect(html).toContain("Title</p>");
    expect(html).toContain("<em>em</em>");
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
    expect(html).toContain('<a href="https://example.com/"');
    expect(html).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(html).toMatch(/<ol[^>]*><li>first<\/li><\/ol>/);
    expect(html).toMatch(/<blockquote[^>]*>quoted<\/blockquote>/);
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;");
  });

  it("escapes HTML and refuses unsafe link targets", () => {
    const html = markdownToHtml(
      "<img src=x onerror=alert(1)> [x](javascript:alert(1))",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript');
  });
});
