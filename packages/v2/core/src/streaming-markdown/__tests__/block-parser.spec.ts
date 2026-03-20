// Derived from hashbrown/packages/core/src/magic-text/block-parser.spec.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import {
  createBlockParserState,
  parseBlockChunk,
  finalizeBlocks,
  Block,
  HeadingBlock,
  ParagraphBlock,
  CodeFenceBlock,
  BlockquoteBlock,
  OrderedListBlock,
  UnorderedListBlock,
  TableBlock,
  ThematicBreakBlock,
} from "../block-parser";

/** Helper: parse a complete markdown string into blocks. */
function parseBlocks(markdown: string): Block[] {
  let state = createBlockParserState();
  state = parseBlockChunk(state, markdown);
  state = finalizeBlocks(state);
  return state.blocks;
}

describe("block-parser", () => {
  describe("headings", () => {
    it("parses h1 through h6", () => {
      const blocks = parseBlocks(
        "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n",
      );
      expect(blocks).toHaveLength(6);
      for (let i = 0; i < 6; i++) {
        expect(blocks[i].type).toBe("heading");
        expect((blocks[i] as HeadingBlock).level).toBe(i + 1);
      }
      expect((blocks[0] as HeadingBlock).content).toBe("H1");
      expect((blocks[5] as HeadingBlock).content).toBe("H6");
    });

    it("parses heading with inline formatting", () => {
      const blocks = parseBlocks("# **Bold** heading\n");
      expect(blocks).toHaveLength(1);
      const h = blocks[0] as HeadingBlock;
      expect(h.type).toBe("heading");
      expect(h.level).toBe(1);
      expect(h.inline).toHaveLength(2);
      expect(h.inline[0]).toEqual({
        type: "bold",
        children: [{ type: "text", content: "Bold" }],
      });
    });
  });

  describe("paragraphs", () => {
    it("parses a simple paragraph", () => {
      const blocks = parseBlocks("Hello world\n");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("paragraph");
      expect((blocks[0] as ParagraphBlock).content).toBe("Hello world");
    });

    it("merges consecutive lines into one paragraph", () => {
      const blocks = parseBlocks("Line one\nLine two\n");
      expect(blocks).toHaveLength(1);
      expect((blocks[0] as ParagraphBlock).content).toBe("Line one\nLine two");
    });

    it("separates paragraphs by blank lines", () => {
      const blocks = parseBlocks("Para one\n\nPara two\n");
      expect(blocks).toHaveLength(2);
      expect((blocks[0] as ParagraphBlock).content).toBe("Para one");
      expect((blocks[1] as ParagraphBlock).content).toBe("Para two");
    });
  });

  describe("code fences", () => {
    it("parses a backtick code fence", () => {
      const blocks = parseBlocks('```javascript\nconsole.log("hi");\n```\n');
      expect(blocks).toHaveLength(1);
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.type).toBe("code_fence");
      expect(cf.language).toBe("javascript");
      expect(cf.content).toBe('console.log("hi");');
      expect(cf.closed).toBe(true);
    });

    it("parses a tilde code fence", () => {
      const blocks = parseBlocks("~~~python\nprint('hi')\n~~~\n");
      expect(blocks).toHaveLength(1);
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.type).toBe("code_fence");
      expect(cf.language).toBe("python");
      expect(cf.content).toBe("print('hi')");
      expect(cf.closed).toBe(true);
    });

    it("handles code fence without language", () => {
      const blocks = parseBlocks("```\nsome code\n```\n");
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.language).toBe("");
      expect(cf.content).toBe("some code");
    });

    it("preserves markdown-like content inside code fences", () => {
      const blocks = parseBlocks(
        "```\n# Not a heading\n**Not bold**\n```\n",
      );
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.content).toBe("# Not a heading\n**Not bold**");
    });

    it("handles unclosed code fence via finalize", () => {
      const blocks = parseBlocks("```js\nunclosed code");
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.type).toBe("code_fence");
      expect(cf.content).toBe("unclosed code");
      expect(cf.closed).toBe(false);
    });

    it("handles longer fence markers (4+ backticks)", () => {
      const blocks = parseBlocks("````\n```\nnested\n```\n````\n");
      expect(blocks).toHaveLength(1);
      const cf = blocks[0] as CodeFenceBlock;
      expect(cf.content).toBe("```\nnested\n```");
      expect(cf.closed).toBe(true);
    });
  });

  describe("blockquotes", () => {
    it("parses a simple blockquote", () => {
      const blocks = parseBlocks("> This is a quote\n");
      expect(blocks).toHaveLength(1);
      const bq = blocks[0] as BlockquoteBlock;
      expect(bq.type).toBe("blockquote");
      expect(bq.children).toHaveLength(1);
      expect((bq.children[0] as ParagraphBlock).content).toBe(
        "This is a quote",
      );
    });

    it("merges consecutive blockquote lines", () => {
      const blocks = parseBlocks("> Line one\n> Line two\n");
      expect(blocks).toHaveLength(1);
      const bq = blocks[0] as BlockquoteBlock;
      expect(bq.children).toHaveLength(1);
      expect((bq.children[0] as ParagraphBlock).content).toBe(
        "Line one\nLine two",
      );
    });

    it("handles nested blockquotes", () => {
      const blocks = parseBlocks("> > Nested quote\n");
      expect(blocks).toHaveLength(1);
      const outer = blocks[0] as BlockquoteBlock;
      expect(outer.children).toHaveLength(1);
      const inner = outer.children[0] as BlockquoteBlock;
      expect(inner.type).toBe("blockquote");
      expect((inner.children[0] as ParagraphBlock).content).toBe(
        "Nested quote",
      );
    });
  });

  describe("ordered lists", () => {
    it("parses an ordered list", () => {
      const blocks = parseBlocks("1. First\n2. Second\n3. Third\n");
      expect(blocks).toHaveLength(1);
      const list = blocks[0] as OrderedListBlock;
      expect(list.type).toBe("ordered_list");
      expect(list.start).toBe(1);
      expect(list.items).toHaveLength(3);
      expect(list.items[0].content).toBe("First");
      expect(list.items[2].content).toBe("Third");
    });

    it("handles non-1 start numbers", () => {
      const blocks = parseBlocks("5. Fifth item\n6. Sixth item\n");
      const list = blocks[0] as OrderedListBlock;
      expect(list.start).toBe(5);
    });

    it("parses list items with inline formatting", () => {
      const blocks = parseBlocks("1. **Bold** item\n");
      const list = blocks[0] as OrderedListBlock;
      expect(list.items[0].inline[0]).toEqual({
        type: "bold",
        children: [{ type: "text", content: "Bold" }],
      });
    });
  });

  describe("unordered lists", () => {
    it("parses an unordered list with dashes", () => {
      const blocks = parseBlocks("- First\n- Second\n");
      expect(blocks).toHaveLength(1);
      const list = blocks[0] as UnorderedListBlock;
      expect(list.type).toBe("unordered_list");
      expect(list.items).toHaveLength(2);
    });

    it("parses an unordered list with asterisks", () => {
      const blocks = parseBlocks("* Alpha\n* Beta\n");
      const list = blocks[0] as UnorderedListBlock;
      expect(list.type).toBe("unordered_list");
      expect(list.items).toHaveLength(2);
      expect(list.items[0].content).toBe("Alpha");
    });

    it("parses an unordered list with plus signs", () => {
      const blocks = parseBlocks("+ One\n+ Two\n");
      const list = blocks[0] as UnorderedListBlock;
      expect(list.type).toBe("unordered_list");
      expect(list.items).toHaveLength(2);
    });
  });

  describe("tables", () => {
    it("parses a simple table", () => {
      const blocks = parseBlocks(
        "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |\n",
      );
      expect(blocks).toHaveLength(1);
      const table = blocks[0] as TableBlock;
      expect(table.type).toBe("table");
      expect(table.headers).toHaveLength(2);
      expect(table.headers[0].content).toBe("Name");
      expect(table.headers[1].content).toBe("Age");
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0][0].content).toBe("Alice");
      expect(table.rows[0][1].content).toBe("30");
      expect(table.rows[1][0].content).toBe("Bob");
      expect(table.rows[1][1].content).toBe("25");
    });

    it("parses table with alignment", () => {
      const blocks = parseBlocks(
        "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n",
      );
      const table = blocks[0] as TableBlock;
      expect(table.alignments).toEqual(["left", "center", "right"]);
    });

    it("parses table with inline formatting in cells", () => {
      const blocks = parseBlocks(
        "| Header |\n| --- |\n| **bold** cell |\n",
      );
      const table = blocks[0] as TableBlock;
      expect(table.rows[0][0].inline[0]).toEqual({
        type: "bold",
        children: [{ type: "text", content: "bold" }],
      });
    });

    it("pads missing cells to match header count", () => {
      const blocks = parseBlocks(
        "| A | B | C |\n| --- | --- | --- |\n| only-one |\n",
      );
      const table = blocks[0] as TableBlock;
      expect(table.rows[0]).toHaveLength(3);
      expect(table.rows[0][0].content).toBe("only-one");
      expect(table.rows[0][1].content).toBe("");
      expect(table.rows[0][2].content).toBe("");
    });

    it("trims excess cells to match header count", () => {
      const blocks = parseBlocks(
        "| A | B |\n| --- | --- |\n| x | y | z | w |\n",
      );
      const table = blocks[0] as TableBlock;
      expect(table.rows[0]).toHaveLength(2);
    });

    it("handles multi-column table with mixed alignment", () => {
      const md = [
        "| ID | Name | Score | Grade |",
        "| ---: | :--- | :---: | --- |",
        "| 1 | Alice | 95 | A |",
        "| 2 | Bob | 87 | B |",
        "| 3 | Charlie | 92 | A |",
        "",
      ].join("\n");
      const blocks = parseBlocks(md);
      const table = blocks[0] as TableBlock;
      expect(table.type).toBe("table");
      expect(table.headers).toHaveLength(4);
      expect(table.alignments).toEqual(["right", "left", "center", "none"]);
      expect(table.rows).toHaveLength(3);
      expect(table.rows[2][1].content).toBe("Charlie");
    });
  });

  describe("thematic breaks", () => {
    it("parses --- as thematic break", () => {
      const blocks = parseBlocks("Text above\n\n---\n\nText below\n");
      expect(blocks).toHaveLength(3);
      expect(blocks[1].type).toBe("thematic_break");
    });

    it("parses *** as thematic break", () => {
      const blocks = parseBlocks("***\n");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("thematic_break");
    });

    it("parses ___ as thematic break", () => {
      const blocks = parseBlocks("___\n");
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("thematic_break");
    });
  });

  describe("stable block IDs", () => {
    it("assigns unique IDs to each block", () => {
      const blocks = parseBlocks("# Heading\n\nParagraph\n\n---\n");
      const ids = blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("preserves block IDs across chunks", () => {
      let state = createBlockParserState();
      state = parseBlockChunk(state, "# Hello\n\n");
      const firstBlocks = finalizeBlocks(state).blocks;
      const headingId = firstBlocks[0].id;

      state = parseBlockChunk(state, "More text\n");
      const secondBlocks = finalizeBlocks(state).blocks;
      // The heading should still have the same ID
      expect(secondBlocks[0].id).toBe(headingId);
    });

    it("table block reuses paragraph ID when upgraded", () => {
      let state = createBlockParserState();
      // First chunk: header row (parsed as paragraph initially)
      state = parseBlockChunk(state, "| A | B |\n");
      const intermediateBlocks = finalizeBlocks(state).blocks;
      const paragraphId = intermediateBlocks[0].id;

      // Second chunk: separator (upgrades paragraph to table)
      state = parseBlockChunk(state, "| --- | --- |\n");
      const tableBlocks = finalizeBlocks(state).blocks;
      // The table should reuse the paragraph's ID
      expect(tableBlocks[0].id).toBe(paragraphId);
      expect(tableBlocks[0].type).toBe("table");
    });
  });

  describe("mixed content", () => {
    it("parses a document with multiple block types", () => {
      const md = [
        "# Title",
        "",
        "A paragraph with **bold** text.",
        "",
        "```python",
        "print('hello')",
        "```",
        "",
        "- Item one",
        "- Item two",
        "",
        "> A quote",
        "",
        "---",
        "",
        "| Col1 | Col2 |",
        "| --- | --- |",
        "| a | b |",
        "",
      ].join("\n");

      const blocks = parseBlocks(md);

      expect(blocks[0].type).toBe("heading");
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[2].type).toBe("code_fence");
      expect(blocks[3].type).toBe("unordered_list");
      expect(blocks[4].type).toBe("blockquote");
      expect(blocks[5].type).toBe("thematic_break");
      expect(blocks[6].type).toBe("table");
    });
  });
});
