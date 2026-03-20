// Derived from hashbrown/packages/core/src/magic-text/index.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Streaming Markdown Parser
 *
 * A proper streaming state-machine parser for markdown, replacing the
 * regex-based completePartialMarkdown() heuristic. Supports headings,
 * paragraphs, lists, blockquotes, code fences, tables (GFM), and
 * inline formatting (bold, italic, code, links, images, strikethrough).
 *
 * Key properties:
 * - Stable block IDs across chunks (critical for React key stability)
 * - Incremental: streaming chunks produce the same result as the whole string
 * - GFM table support (the known completePartialMarkdown bug is fixed)
 */

// State machine (main API)
export {
  createMagicTextParserState,
  parseMagicTextChunk,
  finalizeMagicText,
  type MagicTextParserState,
} from "./state";

// Block types and parser
export {
  type Block,
  type HeadingBlock,
  type ParagraphBlock,
  type CodeFenceBlock,
  type BlockquoteBlock,
  type OrderedListBlock,
  type UnorderedListBlock,
  type TableBlock,
  type TableCell,
  type TableAlignment,
  type ThematicBreakBlock,
  type ListItemBlock,
  type BlockParserState,
  createBlockParserState,
  parseBlockChunk,
  finalizeBlocks,
} from "./block-parser";

// Inline types and parser
export {
  type InlineSegment,
  type TextSegment,
  type BoldSegment,
  type ItalicSegment,
  type CodeSegment,
  type StrikethroughSegment,
  type LinkSegment,
  type ImageSegment,
  parseInline,
  inlineToPlainText,
} from "./inline-parser";

// Segmentation
export { segmentText } from "./segments";

// Citations
export { type Citation, extractCitations } from "./citations";
