// Streaming JSON parser and schema bridge for CopilotKit v2.
// Based on design from hashbrown (https://github.com/liveloveapp/hashbrown)
// License: MIT (see LICENSE-THIRD-PARTY)

// JSON parser
export {
  createParserState,
  parseChunk,
  finalizeJsonParse,
  getResolvedValue,
  type JsonValue,
  type JsonResolvedValue,
  type JsonAstType,
  type JsonAstBase,
  type JsonNullAstNode,
  type JsonBooleanAstNode,
  type JsonNumberAstNode,
  type JsonStringAstNode,
  type JsonArrayAstNode,
  type JsonObjectAstNode,
  type JsonAstNode,
  type ParserError,
  type ParseMode,
  type ParserState,
} from './json-parser';

// Schema builder (exported as `s` namespace)
export * as s from './schema';
