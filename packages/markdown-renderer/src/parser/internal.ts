import type {
  CitationState,
  StreamingMarkdownNodeType,
  StreamingMarkdownParserOptions,
  StreamingMarkdownWarning,
} from "./types";

/**
 * Internal mutable draft representation used before AST materialization.
 * @internal
 */
export type DraftNode = {
  path: string;
  type: StreamingMarkdownNodeType;
  range: { start: number; end: number };
  closed: boolean;
  props: Record<string, unknown>;
  children: DraftNode[];
};

/**
 * Shared mutable parse context used by block and inline parsers.
 * @internal
 */
export type ParseContext = {
  options: StreamingMarkdownParserOptions;
  warnings: StreamingMarkdownWarning[];
  citations: CitationState;
  isComplete: boolean;
  hasWarnedSegmenterUnavailable: boolean;
};

/**
 * Result wrapper for parse helpers that propagate immutable parser context.
 * @internal
 */
export type ParseResult<T> = {
  value: T;
  warnings: StreamingMarkdownWarning[];
  citations: CitationState;
  hasWarnedSegmenterUnavailable: boolean;
};

/**
 * Source line plus absolute source offsets.
 * @internal
 */
export type SourceLine = {
  text: string;
  start: number;
  end: number;
  hasNewline: boolean;
};
