// Derived from hashbrown "Magic Text" (MIT, © LiveLoveApp, LLC). See NOTICE.
/**
 * Magic Text streaming parser API.
 * @public
 */
export {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from './state';

/**
 * Magic Text parser and AST types.
 * @public
 */
export type {
  CitationDefinition,
  CitationState,
  StreamingMarkdownAstNode,
  StreamingMarkdownNodeType,
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserState,
  StreamingMarkdownWarning,
  ParseMode,
  SegmenterOptions,
  TextSegment,
} from './types';
