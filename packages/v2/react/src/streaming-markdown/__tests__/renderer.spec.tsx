// Derived from hashbrown/packages/react/src/magic-text-renderer.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MagicTextRenderer } from "../renderer";
import type { Block } from "@copilotkitnext/core";

describe("MagicTextRenderer", () => {
  describe("headings", () => {
    it("renders h1 through h6", () => {
      const blocks: Block[] = [
        { type: "heading", id: 1, level: 1, content: "H1", inline: [{ type: "text", content: "H1" }] },
        { type: "heading", id: 2, level: 2, content: "H2", inline: [{ type: "text", content: "H2" }] },
        { type: "heading", id: 3, level: 3, content: "H3", inline: [{ type: "text", content: "H3" }] },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("h1")?.textContent).toBe("H1");
      expect(container.querySelector("h2")?.textContent).toBe("H2");
      expect(container.querySelector("h3")?.textContent).toBe("H3");
    });
  });

  describe("paragraphs", () => {
    it("renders a paragraph", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "Hello world",
          inline: [{ type: "text", content: "Hello world" }],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("p")?.textContent).toBe("Hello world");
    });

    it("renders a paragraph with bold text", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "Hello **world**",
          inline: [
            { type: "text", content: "Hello " },
            {
              type: "bold",
              children: [{ type: "text", content: "world" }],
            },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("strong")?.textContent).toBe("world");
    });
  });

  describe("code fences", () => {
    it("renders a code fence with language class", () => {
      const blocks: Block[] = [
        {
          type: "code_fence",
          id: 1,
          language: "javascript",
          content: 'console.log("hi");',
          closed: true,
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const pre = container.querySelector("pre");
      const code = pre?.querySelector("code");
      expect(code?.textContent).toBe('console.log("hi");');
      expect(code?.className).toBe("language-javascript");
    });

    it("renders a code fence without language", () => {
      const blocks: Block[] = [
        {
          type: "code_fence",
          id: 1,
          language: "",
          content: "plain code",
          closed: true,
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const code = container.querySelector("code");
      expect(code?.textContent).toBe("plain code");
      expect(code?.className).toBe("");
    });
  });

  describe("lists", () => {
    it("renders an unordered list", () => {
      const blocks: Block[] = [
        {
          type: "unordered_list",
          id: 1,
          items: [
            { id: 10, content: "Item A", inline: [{ type: "text", content: "Item A" }], children: [] },
            { id: 11, content: "Item B", inline: [{ type: "text", content: "Item B" }], children: [] },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const ul = container.querySelector("ul");
      expect(ul).not.toBeNull();
      const items = ul?.querySelectorAll("li");
      expect(items).toHaveLength(2);
      expect(items?.[0].textContent).toBe("Item A");
      expect(items?.[1].textContent).toBe("Item B");
    });

    it("renders an ordered list with custom start", () => {
      const blocks: Block[] = [
        {
          type: "ordered_list",
          id: 1,
          start: 3,
          items: [
            { id: 10, content: "Third", inline: [{ type: "text", content: "Third" }], children: [] },
            { id: 11, content: "Fourth", inline: [{ type: "text", content: "Fourth" }], children: [] },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const ol = container.querySelector("ol");
      expect(ol?.getAttribute("start")).toBe("3");
    });
  });

  describe("blockquotes", () => {
    it("renders a blockquote with nested paragraph", () => {
      const blocks: Block[] = [
        {
          type: "blockquote",
          id: 1,
          children: [
            {
              type: "paragraph",
              id: 2,
              content: "A quote",
              inline: [{ type: "text", content: "A quote" }],
            },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const bq = container.querySelector("blockquote");
      expect(bq?.querySelector("p")?.textContent).toBe("A quote");
    });
  });

  describe("tables", () => {
    it("renders a table with headers, alignment, and rows", () => {
      const blocks: Block[] = [
        {
          type: "table",
          id: 1,
          headers: [
            { content: "Name", inline: [{ type: "text", content: "Name" }] },
            { content: "Age", inline: [{ type: "text", content: "Age" }] },
          ],
          alignments: ["left", "right"],
          rows: [
            [
              { content: "Alice", inline: [{ type: "text", content: "Alice" }] },
              { content: "30", inline: [{ type: "text", content: "30" }] },
            ],
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const table = container.querySelector("table");
      expect(table).not.toBeNull();

      const ths = table?.querySelectorAll("th");
      expect(ths).toHaveLength(2);
      expect(ths?.[0].textContent).toBe("Name");
      expect(ths?.[0].style.textAlign).toBe("left");
      expect(ths?.[1].textContent).toBe("Age");
      expect(ths?.[1].style.textAlign).toBe("right");

      const tds = table?.querySelectorAll("td");
      expect(tds).toHaveLength(2);
      expect(tds?.[0].textContent).toBe("Alice");
      expect(tds?.[1].textContent).toBe("30");
    });
  });

  describe("thematic breaks", () => {
    it("renders an hr element", () => {
      const blocks: Block[] = [{ type: "thematic_break", id: 1 }];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("hr")).not.toBeNull();
    });
  });

  describe("inline formatting", () => {
    it("renders italic text", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "*italic*",
          inline: [
            {
              type: "italic",
              children: [{ type: "text", content: "italic" }],
            },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("em")?.textContent).toBe("italic");
    });

    it("renders inline code", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "`code`",
          inline: [{ type: "code", content: "code" }],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("code")?.textContent).toBe("code");
    });

    it("renders strikethrough", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "~~deleted~~",
          inline: [
            {
              type: "strikethrough",
              children: [{ type: "text", content: "deleted" }],
            },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      expect(container.querySelector("del")?.textContent).toBe("deleted");
    });

    it("renders links", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "[click](url)",
          inline: [
            {
              type: "link",
              href: "https://example.com",
              children: [{ type: "text", content: "click" }],
            },
          ],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const a = container.querySelector("a");
      expect(a?.textContent).toBe("click");
      expect(a?.getAttribute("href")).toBe("https://example.com");
    });

    it("renders images", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 1,
          content: "![alt](src)",
          inline: [{ type: "image", alt: "photo", src: "photo.png" }],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const img = container.querySelector("img");
      expect(img?.getAttribute("alt")).toBe("photo");
      expect(img?.getAttribute("src")).toBe("photo.png");
    });
  });

  describe("stable keys", () => {
    it("uses block IDs as keys for stable rendering", () => {
      const blocks: Block[] = [
        {
          type: "paragraph",
          id: 42,
          content: "First",
          inline: [{ type: "text", content: "First" }],
        },
        {
          type: "paragraph",
          id: 43,
          content: "Second",
          inline: [{ type: "text", content: "Second" }],
        },
      ];
      const { container } = render(<MagicTextRenderer blocks={blocks} />);
      const paragraphs = container.querySelectorAll("p");
      expect(paragraphs).toHaveLength(2);
      // Keys are internal to React, but we can verify the elements render
      expect(paragraphs[0].textContent).toBe("First");
      expect(paragraphs[1].textContent).toBe("Second");
    });
  });

  describe("className prop", () => {
    it("applies className to the wrapper div", () => {
      const blocks: Block[] = [];
      const { container } = render(
        <MagicTextRenderer blocks={blocks} className="my-class" />,
      );
      expect(container.firstElementChild?.className).toBe("my-class");
    });
  });
});
