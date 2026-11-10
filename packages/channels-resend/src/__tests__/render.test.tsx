/** @jsxImportSource @copilotkit/channels-ui */
import { describe, expect, it } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { markdownToHtml, renderEmail, renderMarkdownEmail } from "../render.js";
import type { EmailControl } from "../render.js";

const text = (value: string): ChannelNode => ({
  type: "text",
  props: { value },
});
const node = (
  type: string,
  props: Record<string, unknown> = {},
  children: ChannelNode[] = [],
): ChannelNode => ({ type, props: { ...props, children } });

describe("renderEmail", () => {
  it("escapes all text, so inbound or agent text cannot inject HTML", () => {
    const body = renderEmail([
      node("message", {}, [
        node("header", {}, [text('<script>alert("x")</script>')]),
        node("section", {}, [text("<img src=x onerror=alert(1)> & co")]),
      ]),
    ]);
    expect(body.html).not.toContain("<script>");
    expect(body.html).not.toContain("<img src=x");
    expect(body.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(body.html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; co");
    expect(body.text).toBe(
      '<script>alert("x")</script>\n\n<img src=x onerror=alert(1)> & co',
    );
  });

  it("renders link buttons as links in both parts", () => {
    const body = renderEmail([
      node("actions", {}, [
        node("button", { url: "https://example.com/track", style: "primary" }, [
          text("Track order"),
        ]),
      ]),
    ]);
    expect(body.html).toMatch(
      /<a href="https:\/\/example\.com\/track"[^>]*>Track order<\/a>/,
    );
    expect(body.text).toBe("Track order: https://example.com/track");
  });

  it("never links a javascript: URL", () => {
    const body = renderEmail([
      node("actions", {}, [
        node("button", { url: "javascript:alert(1)" }, [text("Click")]),
      ]),
      node("markdown", {}, [text("[x](javascript:alert(1))")]),
      node("image", { url: "javascript:alert(1)", alt: "chart" }),
    ]);
    expect(body.html).not.toContain('href="javascript');
    expect(body.html).not.toContain('src="javascript');
  });

  it("keeps only the label of a handler button when there is no link", () => {
    const body = renderEmail([
      node("actions", {}, [
        node("button", { onClick: { id: "ck:approve" }, value: "yes" }, [
          text("Approve"),
        ]),
      ]),
    ]);
    expect(body.html).not.toContain("<a ");
    expect(body.html).toContain("Approve");
    expect(body.text).toBe("Approve");
  });

  it("asks linkFor for each handler control and renders the returned URL", () => {
    const seen: EmailControl[] = [];
    const body = renderEmail(
      [
        node("actions", {}, [
          node("button", { onClick: { id: "ck:a" }, value: { ok: true } }, [
            text("Approve"),
          ]),
          node("select", {
            onSelect: { id: "ck:s" },
            placeholder: "Pick a size",
            options: [
              { label: "Small", value: "s" },
              { label: "Large", value: "l" },
            ],
          }),
        ]),
      ],
      {
        linkFor: (control) => {
          seen.push(control);
          return `https://bot.example.com/hook?ck_action=${control.label}`;
        },
      },
    );
    expect(seen).toEqual([
      {
        actionId: "ck:a",
        value: { ok: true },
        label: "Approve",
        kind: "button",
      },
      { actionId: "ck:s", value: "s", label: "Small", kind: "option" },
      { actionId: "ck:s", value: "l", label: "Large", kind: "option" },
    ]);
    expect(body.html).toContain(
      'href="https://bot.example.com/hook?ck_action=Approve"',
    );
    expect(body.text).toContain(
      "Pick a size\nSmall: https://bot.example.com/hook?ck_action=Small",
    );
  });

  it("escapes the link URL in the href attribute", () => {
    const body = renderEmail(
      [
        node("actions", {}, [
          node("button", { onClick: { id: "ck:a" } }, [text("Go")]),
        ]),
      ],
      { linkFor: () => 'https://x.test/?a=1&b="2"' },
    );
    expect(body.html).toContain(
      'href="https://x.test/?a=1&amp;b=&quot;2&quot;"',
    );
  });

  it("drops inputs and provider-native raw nodes", () => {
    const body = renderEmail([
      node("input", { onSubmit: { id: "ck:i" }, placeholder: "Comment" }),
      node("raw", { raw: { blocks: [] } }),
      node("section", {}, [text("kept")]),
    ]);
    expect(body.text).toBe("kept");
    expect(body.html).not.toContain("Comment");
  });

  it("renders fields, tables, and dividers", () => {
    const body = renderEmail([
      node("fields", {}, [
        node("field", { label: "Order" }, [text("#1234")]),
        node("field", { label: "Status" }, [text("Shipped")]),
      ]),
      node("divider"),
      node(
        "table",
        { columns: [{ header: "Item" }, { header: "Qty", align: "right" }] },
        [
          node("row", {}, [
            node("cell", {}, [text("Socks")]),
            node("cell", {}, [text("2")]),
          ]),
        ],
      ),
    ]);
    expect(body.text).toBe(
      "Order: #1234\nStatus: Shipped\n\n---\n\nItem | Qty\nSocks | 2",
    );
    expect(body.html).toContain("<th");
    expect(body.html).toContain("text-align:right");
  });

  it("uses the message fallbackText when nothing else renders as text", () => {
    const body = renderEmail([
      node("message", { fallbackText: "A card" }, [node("raw", { raw: {} })]),
    ]);
    expect(body.text).toBe("A card");
  });

  it("only accepts simple color values for the accent", () => {
    const body = renderEmail([
      node("message", { accent: "red;background:url(x)" }, [text("hi")]),
    ]);
    expect(body.html).not.toContain("url(x)");
  });

  it("renders JSX built with the channels-ui runtime", async () => {
    const { Message, Section, Actions, Button } =
      await import("@copilotkit/channels-ui");
    const { renderToIR } = await import("@copilotkit/channels-ui");
    const ir = renderToIR(
      <Message>
        <Section>Hello **there**</Section>
        <Actions>
          <Button url="https://example.com">Open</Button>
        </Actions>
      </Message>,
    );
    const body = renderEmail(ir);
    expect(body.html).toContain("<strong>there</strong>");
    expect(body.text).toBe("Hello there\n\nOpen: https://example.com");
  });
});

describe("markdown", () => {
  it("renders the subset agents write", () => {
    const html = markdownToHtml(
      "# Title\n\nSome **bold**, _em_, and `code`.\n\n- one\n- two\n\n1. first\n\n> quoted\n\n```\n<raw> & code\n```",
    );
    expect(html).toContain('font-weight:600">Title</p>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<code");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    expect(html).toContain("<blockquote");
    expect(html).toContain("&lt;raw&gt; &amp; code");
  });

  it("spells out links in the text part", () => {
    expect(renderMarkdownEmail("See [docs](https://x.test/d).").text).toBe(
      "See docs (https://x.test/d).",
    );
  });

  it("does not treat snake_case words as emphasis", () => {
    expect(markdownToHtml("use some_long_name here")).not.toContain("<em>");
  });
});
