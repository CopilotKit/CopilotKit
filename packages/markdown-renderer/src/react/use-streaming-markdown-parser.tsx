import {
  createStreamingMarkdownParserState,
  finalizeStreamingMarkdown,
  type StreamingMarkdownParserOptions,
  type StreamingMarkdownParserState,
  parseStreamingMarkdownChunk,
} from '@copilotkit/markdown-renderer';
import { useMemo, useRef } from 'react';

interface StreamingMarkdownParserSession {
  parserState: StreamingMarkdownParserState;
  text: string;
  optionsKey: string;
  isCompleteInput: boolean;
}

const DEFAULT_OPTIONS: StreamingMarkdownParserOptions = {
  segmenter: true,
  enableTables: true,
  enableAutolinks: true,
};

function normalizeOptions(
  options?: Partial<StreamingMarkdownParserOptions>,
): StreamingMarkdownParserOptions {
  return {
    segmenter: options?.segmenter ?? DEFAULT_OPTIONS.segmenter,
    enableTables: options?.enableTables ?? DEFAULT_OPTIONS.enableTables,
    enableAutolinks: options?.enableAutolinks ?? DEFAULT_OPTIONS.enableAutolinks,
  };
}

function getSegmenterKey(segmenter: StreamingMarkdownParserOptions['segmenter']): string {
  if (segmenter === true || segmenter === false) {
    return String(segmenter);
  }

  const locale = segmenter.locale ?? '';
  const granularity = segmenter.granularity ?? 'word';
  return `object:${locale}:${granularity}`;
}

function getOptionsKey(options: StreamingMarkdownParserOptions): string {
  return `${getSegmenterKey(options.segmenter)}|tables:${String(options.enableTables)}|autolinks:${String(options.enableAutolinks)}`;
}

function parseFullText(
  text: string,
  options: StreamingMarkdownParserOptions,
  isCompleteInput: boolean,
): StreamingMarkdownParserState {
  const initialState = createStreamingMarkdownParserState(options);
  const parsedState = text.length > 0 ? parseStreamingMarkdownChunk(initialState, text) : initialState;

  return isCompleteInput ? finalizeStreamingMarkdown(parsedState) : parsedState;
}

function createSession(
  text: string,
  options: StreamingMarkdownParserOptions,
  optionsKey: string,
  isCompleteInput: boolean,
): StreamingMarkdownParserSession {
  return {
    parserState: parseFullText(text, options, isCompleteInput),
    text,
    optionsKey,
    isCompleteInput,
  };
}

function resolveNextSession(
  previous: StreamingMarkdownParserSession,
  text: string,
  options: StreamingMarkdownParserOptions,
  optionsKey: string,
  isCompleteInput: boolean,
): StreamingMarkdownParserSession {
  const optionsChanged = previous.optionsKey !== optionsKey;
  const completionChanged = previous.isCompleteInput !== isCompleteInput;

  if (optionsChanged) {
    return createSession(text, options, optionsKey, isCompleteInput);
  }

  const textChanged = text !== previous.text;
  if (!textChanged && !completionChanged) {
    return previous;
  }

  if (!textChanged && completionChanged) {
    const parserState = isCompleteInput
      ? finalizeStreamingMarkdown(previous.parserState)
      : parseStreamingMarkdownChunk(previous.parserState, '');

    return {
      ...previous,
      parserState,
      isCompleteInput,
    };
  }

  let nextParserState: StreamingMarkdownParserState;

  if (text.startsWith(previous.text)) {
    const suffix = text.slice(previous.text.length);
    nextParserState =
      suffix.length > 0 ? parseStreamingMarkdownChunk(previous.parserState, suffix) : previous.parserState;
  } else {
    nextParserState = parseFullText(text, options, false);
  }

  if (isCompleteInput) {
    nextParserState = finalizeStreamingMarkdown(nextParserState);
  }

  return {
    parserState: nextParserState,
    text,
    optionsKey,
    isCompleteInput,
  };
}

/**
 * Internal prop-driven hook for streaming markdown parsing in React.
 *
 * @param text - Full markdown text that typically grows over time.
 * @param options - Optional parser option overrides.
 * @param isCompleteInput - When true, finalizes the parse state for the current text.
 * @returns The current immutable streaming markdown parser state.
 */
export function useStreamingMarkdownParser(
  text: string,
  options?: Partial<StreamingMarkdownParserOptions>,
  isCompleteInput = false,
): StreamingMarkdownParserState {
  const sessionRef = useRef<StreamingMarkdownParserSession | null>(null);
  const segmenter = options?.segmenter;
  const segmenterKind =
    typeof segmenter === 'object' && segmenter !== null
      ? 'object'
      : String(segmenter ?? true);
  const segmenterLocale =
    typeof segmenter === 'object' && segmenter !== null
      ? (segmenter.locale ?? '')
      : '';
  const segmenterGranularity =
    typeof segmenter === 'object' && segmenter !== null
      ? (segmenter.granularity ?? 'word')
      : '';
  const normalizedOptions = useMemo(
    () => normalizeOptions(options),
    [
      options?.enableAutolinks,
      options?.enableTables,
      segmenterKind,
      segmenterLocale,
      segmenterGranularity,
    ],
  );
  const optionsKey = getOptionsKey(normalizedOptions);

  const session = useMemo(() => {
    const previous =
      sessionRef.current ??
      createSession(text, normalizedOptions, optionsKey, isCompleteInput);

    const next = resolveNextSession(
      previous,
      text,
      normalizedOptions,
      optionsKey,
      isCompleteInput,
    );

    sessionRef.current = next;
    return next;
  }, [text, normalizedOptions, optionsKey, isCompleteInput]);

  return session.parserState;
}
