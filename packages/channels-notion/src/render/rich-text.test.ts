import { describe, it, expect } from "vitest";
import type { RichTextAnnotations, RichTextItem } from "../types.js";
import {
  clampRichText,
  markdownToRichText,
  plainTextToRichText,
  richTextToPlainText,
} from "./rich-text.js";

function text(content: string, annotations?: RichTextAnnotations) {
  const item: RichTextItem = {
    type: "text",
    text: { content },
    ...(annotations ? { annotations } : {}),
  };
  return item;
}

function link(content: string, url: string) {
  const item: RichTextItem = {
    type: "text",
    text: { content, link: { url } },
  };
  return item;
}

function contentLengths(items: RichTextItem[]) {
  return items
    .map((item) => (item.type === "text" ? item.text.content : ""))
    .map((content) => content.length);
}

describe("markdownToRichText", () => {
  it("returns one plain item for text without Markdown", () => {
    expect(markdownToRichText("hello there")).toEqual([text("hello there")]);
  });

  it("returns no items for empty text", () => {
    expect(markdownToRichText("")).toEqual([]);
  });

  it("maps inline Markdown to annotations and links", () => {
    expect(
      markdownToRichText(
        "a **b** *c* _d_ ~~e~~ `f` [g](https://example.com/x)",
      ),
    ).toEqual([
      text("a "),
      text("b", { bold: true }),
      text(" "),
      text("c", { italic: true }),
      text(" "),
      text("d", { italic: true }),
      text(" "),
      text("e", { strikethrough: true }),
      text(" "),
      text("f", { code: true }),
      text(" "),
      link("g", "https://example.com/x"),
    ]);
  });

  it("nests styles and keeps Markdown literal inside code", () => {
    expect(markdownToRichText("**bold _it_** `**raw**`")).toEqual([
      text("bold ", { bold: true }),
      text("it", { bold: true, italic: true }),
      text(" "),
      text("**raw**", { code: true }),
    ]);
  });

  it("keeps underscores inside words literal", () => {
    expect(markdownToRichText("set my_var_name now")).toEqual([
      text("set my_var_name now"),
    ]);
  });

  it("keeps a non-http link as text, because Notion rejects it", () => {
    expect(markdownToRichText("see [docs](/guide)")).toEqual([
      text("see docs (/guide)"),
    ]);
  });

  it("degrades block Markdown to lines", () => {
    expect(
      markdownToRichText(
        "## Plan\n- one\n- two\n```ts\nconst a = 1;\n```\nend",
      ),
    ).toEqual([
      text("Plan", { bold: true }),
      text("\n- one\n- two\n"),
      text("const a = 1;", { code: true }),
      text("\nend"),
    ]);
  });

  it("splits text longer than 2000 characters over several items", () => {
    expect(contentLengths(markdownToRichText("a".repeat(4500)))).toEqual([
      2000, 2000, 500,
    ]);
  });

  it("caps the array at 100 items and marks the cut", () => {
    const items = markdownToRichText("**a** b ".repeat(80));
    expect(items).toHaveLength(100);
    expect(items[98]).toEqual(text("a", { bold: true }));
    expect(items[99]).toEqual(text("…"));
  });
});

describe("plainTextToRichText", () => {
  it("keeps Markdown characters as literal text", () => {
    expect(plainTextToRichText("1. **not bold**")).toEqual([
      text("1. **not bold**"),
    ]);
  });
});

describe("clampRichText", () => {
  it("returns the items unchanged when they fit", () => {
    expect(clampRichText([text("a"), text("b")], 2)).toEqual([
      text("a"),
      text("b"),
    ]);
  });

  it("replaces the last kept slot with an ellipsis when items are dropped", () => {
    expect(clampRichText([text("a"), text("b"), text("c")], 2)).toEqual([
      text("a"),
      text("…"),
    ]);
  });
});

describe("richTextToPlainText", () => {
  it("joins plain_text, text content, and equations", () => {
    const items: RichTextItem[] = [
      text("Hi "),
      {
        type: "mention",
        mention: { type: "user", user: { object: "user", id: "u1" } },
        plain_text: "@Ada",
      },
      {
        type: "mention",
        mention: { type: "user", user: { object: "user", id: "u2" } },
      },
      text(", see "),
      { type: "equation", equation: { expression: "x^2" } },
    ];
    expect(richTextToPlainText(items)).toBe("Hi @Ada, see x^2");
  });
});
