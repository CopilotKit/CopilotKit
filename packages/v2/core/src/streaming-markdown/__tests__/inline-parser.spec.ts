// Derived from hashbrown/packages/core/src/magic-text/inline-parser.spec.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import { parseInline, inlineToPlainText, InlineSegment } from "../inline-parser";

describe("inline-parser", () => {
  describe("plain text", () => {
    it("parses plain text", () => {
      const result = parseInline("Hello world");
      expect(result).toEqual([{ type: "text", content: "Hello world" }]);
    });

    it("handles empty string", () => {
      const result = parseInline("");
      expect(result).toEqual([]);
    });
  });

  describe("bold", () => {
    it("parses **bold** with asterisks", () => {
      const result = parseInline("This is **bold** text");
      expect(result).toEqual([
        { type: "text", content: "This is " },
        {
          type: "bold",
          children: [{ type: "text", content: "bold" }],
        },
        { type: "text", content: " text" },
      ]);
    });

    it("parses __bold__ with underscores", () => {
      const result = parseInline("This is __bold__ text");
      expect(result).toEqual([
        { type: "text", content: "This is " },
        {
          type: "bold",
          children: [{ type: "text", content: "bold" }],
        },
        { type: "text", content: " text" },
      ]);
    });

    it("does not parse ** with only whitespace content", () => {
      const result = parseInline("This ** is ** not bold");
      expect(result).toEqual([
        { type: "text", content: "This ** is ** not bold" },
      ]);
    });
  });

  describe("italic", () => {
    it("parses *italic* with asterisks", () => {
      const result = parseInline("This is *italic* text");
      expect(result).toEqual([
        { type: "text", content: "This is " },
        {
          type: "italic",
          children: [{ type: "text", content: "italic" }],
        },
        { type: "text", content: " text" },
      ]);
    });

    it("parses _italic_ with underscores", () => {
      const result = parseInline("This is _italic_ text");
      expect(result).toEqual([
        { type: "text", content: "This is " },
        {
          type: "italic",
          children: [{ type: "text", content: "italic" }],
        },
        { type: "text", content: " text" },
      ]);
    });

    it("does not parse _ inside words", () => {
      const result = parseInline("some_variable_name");
      expect(result).toEqual([
        { type: "text", content: "some_variable_name" },
      ]);
    });
  });

  describe("inline code", () => {
    it("parses `code` with single backticks", () => {
      const result = parseInline("Use `code` here");
      expect(result).toEqual([
        { type: "text", content: "Use " },
        { type: "code", content: "code" },
        { type: "text", content: " here" },
      ]);
    });

    it("parses ``code with backticks`` with double backticks", () => {
      const result = parseInline("Use ``code ` here`` ok");
      expect(result).toEqual([
        { type: "text", content: "Use " },
        { type: "code", content: "code ` here" },
        { type: "text", content: " ok" },
      ]);
    });

    it("does not parse inline formatting inside code", () => {
      const result = parseInline("Use `**not bold**` here");
      expect(result).toEqual([
        { type: "text", content: "Use " },
        { type: "code", content: "**not bold**" },
        { type: "text", content: " here" },
      ]);
    });
  });

  describe("strikethrough", () => {
    it("parses ~~strikethrough~~", () => {
      const result = parseInline("This is ~~deleted~~ text");
      expect(result).toEqual([
        { type: "text", content: "This is " },
        {
          type: "strikethrough",
          children: [{ type: "text", content: "deleted" }],
        },
        { type: "text", content: " text" },
      ]);
    });
  });

  describe("links", () => {
    it("parses [text](url) links", () => {
      const result = parseInline("Visit [our site](https://example.com)");
      expect(result).toEqual([
        { type: "text", content: "Visit " },
        {
          type: "link",
          href: "https://example.com",
          children: [{ type: "text", content: "our site" }],
        },
      ]);
    });

    it("parses links with inline formatting in text", () => {
      const result = parseInline("[**bold link**](url)");
      expect(result).toEqual([
        {
          type: "link",
          href: "url",
          children: [
            {
              type: "bold",
              children: [{ type: "text", content: "bold link" }],
            },
          ],
        },
      ]);
    });
  });

  describe("images", () => {
    it("parses ![alt](src) images", () => {
      const result = parseInline("An image: ![alt text](image.png)");
      expect(result).toEqual([
        { type: "text", content: "An image: " },
        { type: "image", alt: "alt text", src: "image.png" },
      ]);
    });
  });

  describe("nested formatting", () => {
    it("parses bold inside italic", () => {
      const result = parseInline("*This is **bold inside italic***");
      expect(result).toEqual([
        {
          type: "italic",
          children: [
            { type: "text", content: "This is " },
            {
              type: "bold",
              children: [{ type: "text", content: "bold inside italic" }],
            },
          ],
        },
      ]);
    });

    it("parses code inside bold", () => {
      const result = parseInline("**Use `code` here**");
      expect(result).toEqual([
        {
          type: "bold",
          children: [
            { type: "text", content: "Use " },
            { type: "code", content: "code" },
            { type: "text", content: " here" },
          ],
        },
      ]);
    });
  });

  describe("escape sequences", () => {
    it("handles escaped asterisks", () => {
      const result = parseInline("This is \\*not italic\\*");
      expect(result).toEqual([
        { type: "text", content: "This is *not italic*" },
      ]);
    });

    it("handles escaped backticks", () => {
      const result = parseInline("Use \\`not code\\`");
      expect(result).toEqual([
        { type: "text", content: "Use `not code`" },
      ]);
    });
  });

  describe("inlineToPlainText", () => {
    it("extracts plain text from segments", () => {
      const segments: InlineSegment[] = [
        { type: "text", content: "Hello " },
        {
          type: "bold",
          children: [{ type: "text", content: "world" }],
        },
        { type: "text", content: " and " },
        { type: "code", content: "code" },
      ];
      expect(inlineToPlainText(segments)).toBe("Hello world and code");
    });
  });
});
