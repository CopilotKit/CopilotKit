// Derived from hashbrown/packages/core/src/magic-text/magic-text.integration.spec.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import { describe, it, expect } from "vitest";
import {
  createMagicTextParserState,
  parseMagicTextChunk,
  finalizeMagicText,
  MagicTextParserState,
} from "../state";
import {
  Block,
  HeadingBlock,
  ParagraphBlock,
  CodeFenceBlock,
  TableBlock,
  UnorderedListBlock,
  OrderedListBlock,
  BlockquoteBlock,
} from "../block-parser";

/** Helper: parse a full string incrementally, one character at a time. */
function parseCharByChar(text: string): Block[] {
  let state = createMagicTextParserState();
  for (const ch of text) {
    state = parseMagicTextChunk(state, ch);
  }
  state = finalizeMagicText(state);
  return state.blocks;
}

/** Helper: parse a full string in a single chunk. */
function parseSingleChunk(text: string): Block[] {
  let state = createMagicTextParserState();
  state = parseMagicTextChunk(state, text);
  state = finalizeMagicText(state);
  return state.blocks;
}

/** Helper: parse in variably-sized chunks. */
function parseInChunks(text: string, chunkSizes: number[]): Block[] {
  let state = createMagicTextParserState();
  let offset = 0;
  for (const size of chunkSizes) {
    const chunk = text.substring(offset, offset + size);
    if (chunk.length === 0) break;
    state = parseMagicTextChunk(state, chunk);
    offset += size;
  }
  if (offset < text.length) {
    state = parseMagicTextChunk(state, text.substring(offset));
  }
  state = finalizeMagicText(state);
  return state.blocks;
}

describe("streaming markdown integration", () => {
  describe("incremental consistency", () => {
    it("produces the same heading from char-by-char and single-chunk parsing", () => {
      const md = "# Hello World\n";
      const single = parseSingleChunk(md);
      const charByChar = parseCharByChar(md);

      expect(single).toHaveLength(1);
      expect(charByChar).toHaveLength(1);
      expect((single[0] as HeadingBlock).content).toBe("Hello World");
      expect((charByChar[0] as HeadingBlock).content).toBe("Hello World");
    });

    it("produces the same paragraph from different chunk sizes", () => {
      const md = "Hello world, this is a test.\n";
      const single = parseSingleChunk(md);
      const chunked = parseInChunks(md, [5, 10, 5, 20]);

      expect(single).toHaveLength(1);
      expect(chunked).toHaveLength(1);
      expect((single[0] as ParagraphBlock).content).toBe(
        (chunked[0] as ParagraphBlock).content,
      );
    });

    it("produces the same code fence from different chunk sizes", () => {
      const md = '```javascript\nconsole.log("hello");\n```\n';
      const single = parseSingleChunk(md);
      const charByChar = parseCharByChar(md);

      expect(single).toHaveLength(1);
      expect(charByChar).toHaveLength(1);

      const singleFence = single[0] as CodeFenceBlock;
      const charFence = charByChar[0] as CodeFenceBlock;
      expect(singleFence.language).toBe(charFence.language);
      expect(singleFence.content).toBe(charFence.content);
      expect(singleFence.closed).toBe(charFence.closed);
    });
  });

  describe("streaming partial states", () => {
    it("shows partial heading content during streaming", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "# Hel");
      // The heading line is buffered because there's no newline yet
      // When we view the blocks, finalization should flush it
      expect(state.blocks).toHaveLength(1);
      const heading = state.blocks[0] as HeadingBlock;
      expect(heading.content).toBe("Hel");

      state = parseMagicTextChunk(state, "lo World\n");
      expect(state.blocks).toHaveLength(1);
      expect((state.blocks[0] as HeadingBlock).content).toBe("Hello World");
    });

    it("shows code fence content growing during streaming", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "```js\n");
      expect(state.blocks).toHaveLength(1);
      expect((state.blocks[0] as CodeFenceBlock).language).toBe("js");
      expect((state.blocks[0] as CodeFenceBlock).content).toBe("");

      state = parseMagicTextChunk(state, "const x = 1;\n");
      expect((state.blocks[0] as CodeFenceBlock).content).toBe("const x = 1;");

      state = parseMagicTextChunk(state, "const y = 2;\n");
      expect((state.blocks[0] as CodeFenceBlock).content).toBe(
        "const x = 1;\nconst y = 2;",
      );
    });

    it("block IDs are stable as content grows", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "# Title\n\n");
      const titleId = state.blocks[0].id;

      state = parseMagicTextChunk(state, "Some text\n");
      expect(state.blocks[0].id).toBe(titleId);
      expect(state.blocks[0].type).toBe("heading");
    });
  });

  describe("table streaming (regression tests)", () => {
    it("streams a simple table correctly", () => {
      let state = createMagicTextParserState();

      // Stream header row
      state = parseMagicTextChunk(state, "| Name | Age |\n");
      // At this point, the header is parsed as a paragraph
      expect(state.blocks).toHaveLength(1);

      // Stream separator
      state = parseMagicTextChunk(state, "| --- | --- |\n");
      // Now it should be a table
      expect(state.blocks).toHaveLength(1);
      expect(state.blocks[0].type).toBe("table");

      // Stream data rows
      state = parseMagicTextChunk(state, "| Alice | 30 |\n");
      const table = state.blocks[0] as TableBlock;
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0][0].content).toBe("Alice");

      state = parseMagicTextChunk(state, "| Bob | 25 |\n");
      const table2 = state.blocks[0] as TableBlock;
      expect(table2.rows).toHaveLength(2);
    });

    it("handles table streamed one character at a time", () => {
      const md =
        "| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |\n";
      const blocks = parseCharByChar(md);

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

    it("handles table with alignment streamed char by char", () => {
      const md = [
        "| Left | Center | Right |",
        "| :--- | :---: | ---: |",
        "| a | b | c |",
        "",
      ].join("\n");

      const blocks = parseCharByChar(md);
      expect(blocks).toHaveLength(1);
      const table = blocks[0] as TableBlock;
      expect(table.alignments).toEqual(["left", "center", "right"]);
      expect(table.rows[0][0].content).toBe("a");
    });

    it("handles table with inline formatting in cells streamed char by char", () => {
      const md = [
        "| Feature | Status |",
        "| --- | --- |",
        "| **Bold** feature | *Active* |",
        "| `code` item | ~~removed~~ |",
        "",
      ].join("\n");

      const blocks = parseCharByChar(md);
      const table = blocks[0] as TableBlock;
      expect(table.type).toBe("table");
      expect(table.rows).toHaveLength(2);

      // Check inline formatting in first row
      expect(table.rows[0][0].inline[0]).toEqual({
        type: "bold",
        children: [{ type: "text", content: "Bold" }],
      });
      expect(table.rows[0][0].inline[1]).toEqual({
        type: "text",
        content: " feature",
      });
    });

    it("handles table followed by other blocks", () => {
      const md = [
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
        "A paragraph after the table.",
        "",
      ].join("\n");

      const blocks = parseSingleChunk(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("table");
      expect(blocks[1].type).toBe("paragraph");
    });

    it("handles table preceded by other blocks", () => {
      const md = [
        "# Title",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "",
      ].join("\n");

      const blocks = parseSingleChunk(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe("heading");
      expect(blocks[1].type).toBe("table");
    });
  });

  describe("complex streaming scenarios", () => {
    it("handles multi-block document streamed in realistic chunks", () => {
      const chunks = [
        "# Getting Started\n\nInstall the package",
        " with:\n\n```bash\nnpm install ",
        "my-package\n```\n\n## Features\n\n",
        "- Fast\n- Reliable\n- Easy to use\n",
      ];

      let state = createMagicTextParserState();
      for (const chunk of chunks) {
        state = parseMagicTextChunk(state, chunk);
      }
      state = finalizeMagicText(state);

      const blocks = state.blocks;
      expect(blocks[0].type).toBe("heading");
      expect((blocks[0] as HeadingBlock).level).toBe(1);
      expect(blocks[1].type).toBe("paragraph");
      expect(blocks[2].type).toBe("code_fence");
      expect((blocks[2] as CodeFenceBlock).content).toBe(
        "npm install my-package",
      );
      expect(blocks[3].type).toBe("heading");
      expect((blocks[3] as HeadingBlock).level).toBe(2);
      expect(blocks[4].type).toBe("unordered_list");
      expect((blocks[4] as UnorderedListBlock).items).toHaveLength(3);
    });

    it("handles blockquote with multiple lines streamed", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "> First line\n");
      state = parseMagicTextChunk(state, "> Second line\n");
      state = finalizeMagicText(state);

      const bq = state.blocks[0] as BlockquoteBlock;
      expect(bq.type).toBe("blockquote");
      expect(bq.children).toHaveLength(1);
      expect((bq.children[0] as ParagraphBlock).content).toBe(
        "First line\nSecond line",
      );
    });

    it("handles ordered list items arriving in separate chunks", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "1. First\n");
      state = parseMagicTextChunk(state, "2. Second\n");
      state = parseMagicTextChunk(state, "3. Third\n");
      state = finalizeMagicText(state);

      const list = state.blocks[0] as OrderedListBlock;
      expect(list.type).toBe("ordered_list");
      expect(list.items).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    it("handles empty input", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "");
      state = finalizeMagicText(state);
      expect(state.blocks).toHaveLength(0);
    });

    it("handles whitespace-only input", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "   \n  \n");
      state = finalizeMagicText(state);
      expect(state.blocks).toHaveLength(0);
    });

    it("handles newline-only input", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "\n\n\n");
      state = finalizeMagicText(state);
      expect(state.blocks).toHaveLength(0);
    });

    it("tracks consumed character count", () => {
      let state = createMagicTextParserState();
      state = parseMagicTextChunk(state, "Hello");
      expect(state.consumed).toBe(5);
      state = parseMagicTextChunk(state, " World");
      expect(state.consumed).toBe(11);
    });
  });
});
