import { normalizeOptions } from "../parser/helpers";
import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  parseStreamingMarkdownChunk,
} from "../parser/state";
import type {
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserState,
} from "../parser/types";

/**
 * Parser state plus the inputs that produced it, so the next update can parse
 * only the appended text.
 *
 * @public
 */
export interface StreamingMarkdownParserSession {
  parserState: StreamingMarkdownParserState;
  text: string;
  optionsKey: string;
  isCompleteInput: boolean;
}

function getSegmenterKey(
  segmenter: StreamingMarkdownParserOptions["segmenter"],
) {
  if (segmenter === true || segmenter === false) {
    return String(segmenter);
  }

  const locale = segmenter.locale ?? "";
  const granularity = segmenter.granularity ?? "word";
  return `object:${locale}:${granularity}`;
}

function getOptionsKey(options: StreamingMarkdownParserOptions) {
  return `${getSegmenterKey(options.segmenter)}|tables:${String(options.enableTables)}|autolinks:${String(options.enableAutolinks)}|math:${String(options.enableMath)}`;
}

function parseFullText(
  text: string,
  options: StreamingMarkdownParserOptions,
  isCompleteInput: boolean,
) {
  const initialState = createStreamingMarkdownParserState(options);
  const parsedState =
    text.length > 0
      ? parseStreamingMarkdownChunk(initialState, text)
      : initialState;

  return isCompleteInput ? finalizeStreamingMarkdown(parsedState) : parsedState;
}

/**
 * Returns the parser session for `text`, reusing `previous` when it can.
 *
 * - Same inputs: returns `previous` unchanged.
 * - Text grew by a suffix: parses only the suffix, so unchanged AST nodes keep
 *   their identity (renderers rely on this to keep DOM and animations stable).
 * - Text was replaced or options changed: parses from scratch.
 * - `isComplete` toggled: finalizes (or re-opens) the current state.
 *
 * @param previous - The session from the last update, or `null` on first use.
 * @param text - Full markdown source, which usually grows over time.
 * @param options - Parser option overrides.
 * @param isCompleteInput - `true` once the source is final.
 * @public
 */
export function updateStreamingMarkdownParserSession(
  previous: StreamingMarkdownParserSession | null,
  text: string,
  options: Partial<StreamingMarkdownParserOptions> | undefined,
  isCompleteInput: boolean,
): StreamingMarkdownParserSession {
  const normalized = normalizeOptions(options);
  const optionsKey = getOptionsKey(normalized);

  if (previous === null || previous.optionsKey !== optionsKey) {
    return {
      parserState: parseFullText(text, normalized, isCompleteInput),
      text,
      optionsKey,
      isCompleteInput,
    };
  }

  const textChanged = text !== previous.text;
  const completionChanged = previous.isCompleteInput !== isCompleteInput;
  if (!textChanged && !completionChanged) {
    return previous;
  }

  if (!textChanged) {
    const parserState = isCompleteInput
      ? finalizeStreamingMarkdown(previous.parserState)
      : parseStreamingMarkdownChunk(previous.parserState, "");
    return { ...previous, parserState, isCompleteInput };
  }

  const suffix = text.startsWith(previous.text)
    ? text.slice(previous.text.length)
    : null;
  const parsed =
    suffix === null
      ? parseFullText(text, normalized, false)
      : parseStreamingMarkdownChunk(previous.parserState, suffix);

  return {
    parserState: isCompleteInput ? finalizeStreamingMarkdown(parsed) : parsed,
    text,
    optionsKey,
    isCompleteInput,
  };
}
