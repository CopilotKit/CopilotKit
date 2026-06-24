type SegmentGranularity = "grapheme" | "word" | "sentence";

/**
 * Segmenter configuration for parse-time text segmentation.
 * @public
 */
export type SegmenterOptions =
  | false
  | true
  | {
      locale?: string;
      granularity?: SegmentGranularity;
    };

/**
 * Options for the streaming markdown parser.
 * @public
 */
export type StreamingMarkdownParserOptions = {
  segmenter: SegmenterOptions;
  enableTables: boolean;
  enableAutolinks: boolean;
};

/**
 * Supported streaming markdown AST node kinds.
 * @public
 */
export type StreamingMarkdownNodeType =
  | "document"
  | "paragraph"
  | "heading"
  | "blockquote"
  | "list"
  | "list-item"
  | "code-block"
  | "table"
  | "table-row"
  | "table-cell"
  | "thematic-break"
  | "text"
  | "em"
  | "strong"
  | "strikethrough"
  | "inline-code"
  | "soft-break"
  | "hard-break"
  | "image"
  | "link"
  | "autolink"
  | "citation";

/**
 * Parsing mode for block-level processing.
 * @public
 */
export type ParseMode =
  | "block"
  | "paragraph"
  | "heading"
  | "blockquote"
  | "list-item"
  | "code-fence"
  | "table";

/**
 * Parser warning variants.
 * @public
 */
export type StreamingMarkdownWarning =
  | { code: "unterminated_construct"; kind: string; at: number }
  | { code: "invalid_citation_definition"; at: number }
  | { code: "unmatched_closer"; token: string; at: number }
  | { code: "segmenter_unavailable"; at: number }
  | { code: "unknown_construct"; at: number };

/**
 * Parse-time text segment for animation-friendly rendering.
 * @public
 */
export type TextSegment = {
  text: string;
  start: number;
  end: number;
  kind: SegmentGranularity;
  isWhitespace: boolean;
  /**
   * Hint for renderers to avoid line-breaking before this segment.
   * @public
   */
  noBreakBefore?: boolean;
};

/**
 * Shared fields on all AST nodes.
 * @public
 */
export type StreamingMarkdownAstNodeBase = {
  id: number;
  type: StreamingMarkdownNodeType;
  parentId: number | null;
  closed: boolean;
  range: { start: number; end: number };
};

/**
 * AST node representing the document root.
 * @public
 */
export type StreamingMarkdownDocumentNode = StreamingMarkdownAstNodeBase & {
  type: "document";
  children: number[];
};

/**
 * AST node representing a paragraph.
 * @public
 */
export type StreamingMarkdownParagraphNode = StreamingMarkdownAstNodeBase & {
  type: "paragraph";
  children: number[];
};

/**
 * AST node representing a heading.
 * @public
 */
export type StreamingMarkdownHeadingNode = StreamingMarkdownAstNodeBase & {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: number[];
};

/**
 * AST node representing a blockquote.
 * @public
 */
export type StreamingMarkdownBlockquoteNode = StreamingMarkdownAstNodeBase & {
  type: "blockquote";
  children: number[];
};

/**
 * AST node representing a list.
 * @public
 */
export type StreamingMarkdownListNode = StreamingMarkdownAstNodeBase & {
  type: "list";
  ordered: boolean;
  start: number | null;
  tight: boolean;
  children: number[];
};

/**
 * AST node representing a list item.
 * @public
 */
export type StreamingMarkdownListItemNode = StreamingMarkdownAstNodeBase & {
  type: "list-item";
  children: number[];
};

/**
 * AST node representing a fenced code block.
 * @public
 */
export type StreamingMarkdownCodeBlockNode = StreamingMarkdownAstNodeBase & {
  type: "code-block";
  fence: "```" | "~~~";
  info?: string;
  meta?: string;
  text: string;
};

/**
 * AST node representing a table.
 * @public
 */
export type StreamingMarkdownTableNode = StreamingMarkdownAstNodeBase & {
  type: "table";
  align: Array<"left" | "right" | "center" | "none">;
  children: number[];
};

/**
 * AST node representing a table row.
 * @public
 */
export type StreamingMarkdownTableRowNode = StreamingMarkdownAstNodeBase & {
  type: "table-row";
  isHeader: boolean;
  children: number[];
};

/**
 * AST node representing a table cell.
 * @public
 */
export type StreamingMarkdownTableCellNode = StreamingMarkdownAstNodeBase & {
  type: "table-cell";
  children: number[];
};

/**
 * AST node representing a thematic break.
 * @public
 */
export type StreamingMarkdownThematicBreakNode =
  StreamingMarkdownAstNodeBase & {
    type: "thematic-break";
  };

/**
 * AST node representing a text run.
 * @public
 */
export type StreamingMarkdownTextNode = StreamingMarkdownAstNodeBase & {
  type: "text";
  text: string;
  segments: TextSegment[];
};

/**
 * AST node representing emphasis.
 * @public
 */
export type StreamingMarkdownEmphasisNode = StreamingMarkdownAstNodeBase & {
  type: "em";
  children: number[];
};

/**
 * AST node representing strong emphasis.
 * @public
 */
export type StreamingMarkdownStrongNode = StreamingMarkdownAstNodeBase & {
  type: "strong";
  children: number[];
};

/**
 * AST node representing strikethrough.
 * @public
 */
export type StreamingMarkdownStrikethroughNode =
  StreamingMarkdownAstNodeBase & {
    type: "strikethrough";
    children: number[];
  };

/**
 * AST node representing inline code.
 * @public
 */
export type StreamingMarkdownInlineCodeNode = StreamingMarkdownAstNodeBase & {
  type: "inline-code";
  text: string;
};

/**
 * AST node representing a soft line break.
 * @public
 */
export type StreamingMarkdownSoftBreakNode = StreamingMarkdownAstNodeBase & {
  type: "soft-break";
};

/**
 * AST node representing a hard line break.
 * @public
 */
export type StreamingMarkdownHardBreakNode = StreamingMarkdownAstNodeBase & {
  type: "hard-break";
};

/**
 * AST node representing a link.
 * @public
 */
export type StreamingMarkdownLinkNode = StreamingMarkdownAstNodeBase & {
  type: "link";
  url: string;
  title?: string;
  children: number[];
};

/**
 * AST node representing an image.
 * @public
 */
export type StreamingMarkdownImageNode = StreamingMarkdownAstNodeBase & {
  type: "image";
  url: string;
  title?: string;
  alt: string;
};

/**
 * AST node representing an autolink.
 * @public
 */
export type StreamingMarkdownAutolinkNode = StreamingMarkdownAstNodeBase & {
  type: "autolink";
  url: string;
  text: string;
};

/**
 * AST node representing a citation reference.
 * @public
 */
export type StreamingMarkdownCitationNode = StreamingMarkdownAstNodeBase & {
  type: "citation";
  idRef: string;
  number?: number;
};

/**
 * Union of all AST node shapes.
 * @public
 */
export type StreamingMarkdownAstNode =
  | StreamingMarkdownDocumentNode
  | StreamingMarkdownParagraphNode
  | StreamingMarkdownHeadingNode
  | StreamingMarkdownBlockquoteNode
  | StreamingMarkdownListNode
  | StreamingMarkdownListItemNode
  | StreamingMarkdownCodeBlockNode
  | StreamingMarkdownTableNode
  | StreamingMarkdownTableRowNode
  | StreamingMarkdownTableCellNode
  | StreamingMarkdownThematicBreakNode
  | StreamingMarkdownTextNode
  | StreamingMarkdownEmphasisNode
  | StreamingMarkdownStrongNode
  | StreamingMarkdownStrikethroughNode
  | StreamingMarkdownInlineCodeNode
  | StreamingMarkdownSoftBreakNode
  | StreamingMarkdownHardBreakNode
  | StreamingMarkdownImageNode
  | StreamingMarkdownLinkNode
  | StreamingMarkdownAutolinkNode
  | StreamingMarkdownCitationNode;

/**
 * Citation definition captured during parsing.
 * @public
 */
export type CitationDefinition = {
  id: string;
  text: string;
  url?: string;
};

/**
 * Citation parser state.
 * @public
 */
export type CitationState = {
  order: string[];
  numbers: Record<string, number>;
  definitions: Record<string, CitationDefinition>;
};

/**
 * Immutable state for streaming markdown parsing.
 * @public
 */
export type StreamingMarkdownParserState = {
  nextId: number;
  nodes: StreamingMarkdownAstNode[];
  rootId: number | null;
  stack: number[];
  mode: ParseMode;
  warnings: StreamingMarkdownWarning[];
  citations: CitationState;
  lineBuffer: string;
  isComplete: boolean;
  index: number;
  line: number;
  column: number;
  options: StreamingMarkdownParserOptions;
  source: string;
  pathToId: Record<string, number>;
  pendingCarriageReturn: boolean;
  hasWarnedSegmenterUnavailable: boolean;
};
