// Derived from hashbrown/packages/core/src/magic-text/block-parser.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Block-level parser for streaming markdown.
 *
 * Parses markdown text into a tree of blocks: headings, paragraphs,
 * lists (ordered/unordered), blockquotes, code fences, tables, and
 * thematic breaks.
 *
 * Each block receives a stable numeric ID on creation, which persists
 * across incremental parsing chunks. This is critical for React key
 * stability during streaming rendering.
 */

import { parseInline, InlineSegment } from "./inline-parser";

// ─── Block types ────────────────────────────────────────────────

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeFenceBlock
  | BlockquoteBlock
  | OrderedListBlock
  | UnorderedListBlock
  | TableBlock
  | ThematicBreakBlock;

export interface HeadingBlock {
  type: "heading";
  id: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: string;
  inline: InlineSegment[];
}

export interface ParagraphBlock {
  type: "paragraph";
  id: number;
  content: string;
  inline: InlineSegment[];
}

export interface CodeFenceBlock {
  type: "code_fence";
  id: number;
  language: string;
  content: string;
  closed: boolean;
}

export interface BlockquoteBlock {
  type: "blockquote";
  id: number;
  children: Block[];
}

export interface ListItemBlock {
  id: number;
  content: string;
  inline: InlineSegment[];
  children: Block[];
}

export interface OrderedListBlock {
  type: "ordered_list";
  id: number;
  start: number;
  items: ListItemBlock[];
}

export interface UnorderedListBlock {
  type: "unordered_list";
  id: number;
  items: ListItemBlock[];
}

export interface TableBlock {
  type: "table";
  id: number;
  headers: TableCell[];
  alignments: TableAlignment[];
  rows: TableCell[][];
}

export interface TableCell {
  content: string;
  inline: InlineSegment[];
}

export type TableAlignment = "left" | "center" | "right" | "none";

export interface ThematicBreakBlock {
  type: "thematic_break";
  id: number;
}

// ─── Parser state ──────────────────────────────────────────────

export interface BlockParserState {
  blocks: Block[];
  /** Monotonically increasing block ID counter */
  nextId: number;
  /** Buffered text that hasn't yet been committed to a block */
  buffer: string;
  /** Whether we're currently inside a code fence */
  inCodeFence: boolean;
  /** The fence marker (e.g. "```" or "~~~") for matching the closing fence */
  codeFenceMarker: string;
  /** The indent of the opening fence */
  codeFenceIndent: number;
  /** ID of the current code fence block (when inside one) */
  codeFenceBlockId: number;
  /** Whether we're accumulating table rows */
  inTable: boolean;
  /** ID of the current table block */
  tableBlockId: number;
  /** Whether the last processed line was blank (for paragraph separation) */
  lastLineWasBlank: boolean;
}

export function createBlockParserState(): BlockParserState {
  return {
    blocks: [],
    nextId: 1,
    buffer: "",
    inCodeFence: false,
    codeFenceMarker: "",
    codeFenceIndent: 0,
    codeFenceBlockId: -1,
    inTable: false,
    tableBlockId: -1,
    lastLineWasBlank: true, // Start true so first paragraph is always new
  };
}

// ─── Line-level regexes ────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const CODE_FENCE_OPEN_RE = /^(\s*)((`{3,})(.*?)|(~{3,})(.*?))$/;
const ORDERED_LIST_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const UNORDERED_LIST_RE = /^(\s*)[-*+]\s+(.*)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const THEMATIC_BREAK_RE = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const TABLE_ROW_RE = /^\|(.+)\|?\s*$/;
// Matches GFM table separator rows like | --- | --- | or |:---:|---:|
// Also handles single-column tables like | --- |
const TABLE_SEPARATOR_RE =
  /^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|?\s*$/;

// ─── Core parsing ──────────────────────────────────────────────

/**
 * Feed a chunk of text into the block parser. Returns a new state
 * with the block tree updated. The state is immutable — each call
 * returns a fresh object.
 */
export function parseBlockChunk(
  state: BlockParserState,
  chunk: string,
): BlockParserState {
  // Combine any leftover buffer with new chunk
  const text = state.buffer + chunk;

  // Clone state for mutation
  const s: BlockParserState = {
    ...state,
    blocks: state.blocks.map(cloneBlock),
    buffer: "",
  };

  // Split into lines, keeping the last (potentially incomplete) line in buffer
  const lines = text.split("\n");
  // The last element might be a partial line; buffer it unless it ends with \n
  if (!text.endsWith("\n")) {
    s.buffer = lines.pop()!;
  } else {
    // Text ended with newline, so last split is empty string
    lines.pop();
  }

  for (const line of lines) {
    processLine(s, line);
  }

  return s;
}

/**
 * Finalize the parser state — flush any remaining buffer as a block.
 */
export function finalizeBlocks(state: BlockParserState): BlockParserState {
  const s: BlockParserState = {
    ...state,
    blocks: state.blocks.map(cloneBlock),
    buffer: state.buffer, // Preserve buffer for finalization processing
  };

  // If we're in a code fence, append any remaining buffer to its content
  if (s.inCodeFence && s.buffer.length > 0) {
    const block = findBlockById(s.blocks, s.codeFenceBlockId) as
      | CodeFenceBlock
      | undefined;
    if (block) {
      if (block.content.length > 0) {
        block.content += "\n" + s.buffer;
      } else {
        block.content = s.buffer;
      }
    }
    s.buffer = "";
    return s;
  }

  // If there's buffered text, flush it
  if (s.buffer.length > 0) {
    processLine(s, s.buffer);
    s.buffer = "";
  }

  // Close any open table
  if (s.inTable) {
    s.inTable = false;
    s.tableBlockId = -1;
  }

  return s;
}

// ─── Line processing ───────────────────────────────────────────

function processLine(s: BlockParserState, line: string): void {
  // Inside a code fence — check for closing fence or append content
  if (s.inCodeFence) {
    if (isClosingFence(line, s.codeFenceMarker, s.codeFenceIndent)) {
      const block = findBlockById(s.blocks, s.codeFenceBlockId) as
        | CodeFenceBlock
        | undefined;
      if (block) {
        block.closed = true;
      }
      s.inCodeFence = false;
      s.codeFenceMarker = "";
      s.codeFenceIndent = 0;
      s.codeFenceBlockId = -1;
      return;
    }

    const block = findBlockById(s.blocks, s.codeFenceBlockId) as
      | CodeFenceBlock
      | undefined;
    if (block) {
      if (block.content.length > 0) {
        block.content += "\n" + line;
      } else {
        block.content = line;
      }
    }
    return;
  }

  // Remember whether previous line was blank (for paragraph separation)
  // then reset the flag — blank line handler will set it back if needed
  const prevLineWasBlank = s.lastLineWasBlank;
  s.lastLineWasBlank = false;

  // Thematic break
  if (THEMATIC_BREAK_RE.test(line)) {
    closeTable(s);
    const id = s.nextId++;
    s.blocks.push({ type: "thematic_break", id });
    return;
  }

  // Code fence opening
  const fenceMatch = CODE_FENCE_OPEN_RE.exec(line);
  if (fenceMatch) {
    closeTable(s);
    const indent = fenceMatch[1]?.length ?? 0;
    // fenceMatch[3] is backtick fence, fenceMatch[5] is tilde fence
    const marker = fenceMatch[3] || fenceMatch[5] || "";
    const language = (fenceMatch[4] || fenceMatch[6] || "").trim();
    const id = s.nextId++;
    s.blocks.push({
      type: "code_fence",
      id,
      language,
      content: "",
      closed: false,
    });
    s.inCodeFence = true;
    s.codeFenceMarker = marker;
    s.codeFenceIndent = indent;
    s.codeFenceBlockId = id;
    return;
  }

  // Heading
  const headingMatch = HEADING_RE.exec(line);
  if (headingMatch) {
    closeTable(s);
    const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
    const content = headingMatch[2];
    const id = s.nextId++;
    s.blocks.push({
      type: "heading",
      id,
      level,
      content,
      inline: parseInline(content),
    });
    return;
  }

  // Blockquote
  const blockquoteMatch = BLOCKQUOTE_RE.exec(line);
  if (blockquoteMatch) {
    closeTable(s);
    const innerContent = blockquoteMatch[1];
    const lastBlock = s.blocks[s.blocks.length - 1];

    if (lastBlock && lastBlock.type === "blockquote") {
      // Append to existing blockquote by parsing inner as a mini-block
      appendToBlockquote(s, lastBlock, innerContent);
    } else {
      const id = s.nextId++;
      const bq: BlockquoteBlock = { type: "blockquote", id, children: [] };
      s.blocks.push(bq);
      appendToBlockquote(s, bq, innerContent);
    }
    return;
  }

  // Table detection — a line starting with | and containing |
  if (TABLE_ROW_RE.test(line)) {
    if (s.inTable) {
      // Continuing an existing table
      appendTableRow(s, line);
      return;
    }

    // Check if the previous block is a paragraph that looks like a table header.
    // This handles the case where the header row was parsed as a paragraph
    // before we saw the separator.
    const lastBlock = s.blocks[s.blocks.length - 1];
    if (
      lastBlock &&
      lastBlock.type === "paragraph" &&
      TABLE_ROW_RE.test(lastBlock.content)
    ) {
      // This line could be a separator — check
      if (TABLE_SEPARATOR_RE.test(line)) {
        // Convert the paragraph to a table header
        const headerContent = lastBlock.content;
        const headers = parseTableCells(headerContent);
        const alignments = parseTableAlignments(line);
        const id = lastBlock.id; // Reuse the paragraph's ID for stability
        const table: TableBlock = {
          type: "table",
          id,
          headers,
          alignments,
          rows: [],
        };
        // Replace the paragraph with the table
        const idx = s.blocks.indexOf(lastBlock);
        s.blocks[idx] = table;
        s.inTable = true;
        s.tableBlockId = id;
        return;
      }
    }

    // Otherwise start treating it as a potential table header (paragraph for now)
    // It might become a table if the next line is a separator
    const id = s.nextId++;
    s.blocks.push({
      type: "paragraph",
      id,
      content: line,
      inline: parseInline(line),
    });
    return;
  }

  // If we were in a table and got a non-table line, close the table
  if (s.inTable && !TABLE_ROW_RE.test(line)) {
    closeTable(s);
  }

  // Ordered list
  const orderedMatch = ORDERED_LIST_RE.exec(line);
  if (orderedMatch) {
    closeTable(s);
    const startNum = parseInt(orderedMatch[2], 10);
    const content = orderedMatch[3];
    const lastBlock = s.blocks[s.blocks.length - 1];

    if (lastBlock && lastBlock.type === "ordered_list") {
      const itemId = s.nextId++;
      lastBlock.items.push({
        id: itemId,
        content,
        inline: parseInline(content),
        children: [],
      });
    } else {
      const id = s.nextId++;
      const itemId = s.nextId++;
      s.blocks.push({
        type: "ordered_list",
        id,
        start: startNum,
        items: [
          {
            id: itemId,
            content,
            inline: parseInline(content),
            children: [],
          },
        ],
      });
    }
    return;
  }

  // Unordered list
  const unorderedMatch = UNORDERED_LIST_RE.exec(line);
  if (unorderedMatch) {
    closeTable(s);
    const content = unorderedMatch[2];
    const lastBlock = s.blocks[s.blocks.length - 1];

    if (lastBlock && lastBlock.type === "unordered_list") {
      const itemId = s.nextId++;
      lastBlock.items.push({
        id: itemId,
        content,
        inline: parseInline(content),
        children: [],
      });
    } else {
      const id = s.nextId++;
      const itemId = s.nextId++;
      s.blocks.push({
        type: "unordered_list",
        id,
        items: [
          {
            id: itemId,
            content,
            inline: parseInline(content),
            children: [],
          },
        ],
      });
    }
    return;
  }

  // Empty line — acts as a block separator
  if (line.trim() === "") {
    closeTable(s);
    s.lastLineWasBlank = true;
    return;
  }

  // Default: paragraph
  const lastBlock = s.blocks[s.blocks.length - 1];
  if (lastBlock && lastBlock.type === "paragraph" && !prevLineWasBlank) {
    // Append to the existing paragraph (soft line break)
    lastBlock.content += "\n" + line;
    lastBlock.inline = parseInline(lastBlock.content);
  } else {
    const id = s.nextId++;
    s.blocks.push({
      type: "paragraph",
      id,
      content: line,
      inline: parseInline(line),
    });
  }
  s.lastLineWasBlank = false;
}

// ─── Table helpers ─────────────────────────────────────────────

function parseTableCells(line: string): TableCell[] {
  // Remove leading/trailing pipe and split
  let content = line.trim();
  if (content.startsWith("|")) content = content.substring(1);
  if (content.endsWith("|")) content = content.substring(0, content.length - 1);

  return content.split("|").map((cell) => {
    const trimmed = cell.trim();
    return {
      content: trimmed,
      inline: parseInline(trimmed),
    };
  });
}

function parseTableAlignments(line: string): TableAlignment[] {
  let content = line.trim();
  if (content.startsWith("|")) content = content.substring(1);
  if (content.endsWith("|")) content = content.substring(0, content.length - 1);

  return content.split("|").map((cell) => {
    const trimmed = cell.trim();
    const leftColon = trimmed.startsWith(":");
    const rightColon = trimmed.endsWith(":");

    if (leftColon && rightColon) return "center";
    if (rightColon) return "right";
    if (leftColon) return "left";
    return "none";
  });
}

function appendTableRow(s: BlockParserState, line: string): void {
  const table = findBlockById(s.blocks, s.tableBlockId) as
    | TableBlock
    | undefined;
  if (!table) return;

  // Check if this is a separator line (can happen with multi-separator tables)
  if (TABLE_SEPARATOR_RE.test(line)) {
    return; // Skip duplicate separator lines
  }

  const cells = parseTableCells(line);

  // Pad or trim cells to match header count
  const headerCount = table.headers.length;
  while (cells.length < headerCount) {
    cells.push({ content: "", inline: [] });
  }
  if (cells.length > headerCount) {
    cells.length = headerCount;
  }

  table.rows.push(cells);
}

function closeTable(s: BlockParserState): void {
  if (s.inTable) {
    s.inTable = false;
    s.tableBlockId = -1;
  }
}

// ─── Code fence helpers ────────────────────────────────────────

function isClosingFence(
  line: string,
  openMarker: string,
  openIndent: number,
): boolean {
  const trimmedLine = line.trimStart();
  const lineIndent = line.length - trimmedLine.length;

  // Closing fence indent must not exceed opening indent + 3
  if (lineIndent > openIndent + 3) return false;

  const fenceChar = openMarker[0]; // ` or ~
  const openLength = openMarker.length;

  // Count consecutive fence chars
  let count = 0;
  for (let i = 0; i < trimmedLine.length; i++) {
    if (trimmedLine[i] === fenceChar) {
      count++;
    } else {
      break;
    }
  }

  // Closing fence must be at least as long as the opening fence
  if (count < openLength) return false;

  // Nothing after the closing fence except whitespace
  const afterFence = trimmedLine.substring(count).trim();
  return afterFence === "";
}

// ─── Blockquote helpers ────────────────────────────────────────

function appendToBlockquote(
  s: BlockParserState,
  bq: BlockquoteBlock,
  content: string,
): void {
  // Check if the content itself is a blockquote (nested)
  const nestedMatch = BLOCKQUOTE_RE.exec(content);
  if (nestedMatch) {
    const lastChild = bq.children[bq.children.length - 1];
    if (lastChild && lastChild.type === "blockquote") {
      appendToBlockquote(s, lastChild, nestedMatch[1]);
    } else {
      const nestedBq: BlockquoteBlock = {
        type: "blockquote",
        id: s.nextId++,
        children: [],
      };
      bq.children.push(nestedBq);
      appendToBlockquote(s, nestedBq, nestedMatch[1]);
    }
    return;
  }

  // Check if content is a heading
  const headingMatch = HEADING_RE.exec(content);
  if (headingMatch) {
    const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
    const headingContent = headingMatch[2];
    bq.children.push({
      type: "heading",
      id: s.nextId++,
      level,
      content: headingContent,
      inline: parseInline(headingContent),
    });
    return;
  }

  // Otherwise treat as paragraph
  const lastChild = bq.children[bq.children.length - 1];
  if (lastChild && lastChild.type === "paragraph") {
    lastChild.content += "\n" + content;
    lastChild.inline = parseInline(lastChild.content);
  } else {
    bq.children.push({
      type: "paragraph",
      id: s.nextId++,
      content,
      inline: parseInline(content),
    });
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function findBlockById(blocks: Block[], id: number): Block | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.type === "blockquote") {
      const found = findBlockById(block.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function cloneBlock(block: Block): Block {
  switch (block.type) {
    case "heading":
      return { ...block, inline: [...block.inline] };
    case "paragraph":
      return { ...block, inline: [...block.inline] };
    case "code_fence":
      return { ...block };
    case "thematic_break":
      return { ...block };
    case "blockquote":
      return { ...block, children: block.children.map(cloneBlock) };
    case "ordered_list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          inline: [...item.inline],
          children: item.children.map(cloneBlock),
        })),
      };
    case "unordered_list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          inline: [...item.inline],
          children: item.children.map(cloneBlock),
        })),
      };
    case "table":
      return {
        ...block,
        headers: block.headers.map((h) => ({ ...h, inline: [...h.inline] })),
        alignments: [...block.alignments],
        rows: block.rows.map((row) =>
          row.map((cell) => ({ ...cell, inline: [...cell.inline] })),
        ),
      };
  }
}
