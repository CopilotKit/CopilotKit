import { updateStreamingMarkdownParserSession } from "@copilotkit/markdown";
import type {
  StreamingMarkdownParserOptions,
  StreamingMarkdownParserSession,
} from "@copilotkit/markdown";
import { useMemo, useRef } from "react";

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
) {
  const sessionRef = useRef<StreamingMarkdownParserSession | null>(null);
  // The session compares options by value, so a new options object with the
  // same values keeps the parsed state (and node identity).
  const session = useMemo(() => {
    const next = updateStreamingMarkdownParserSession(
      sessionRef.current,
      text,
      options,
      isCompleteInput,
    );
    sessionRef.current = next;
    return next;
  }, [text, options, isCompleteInput]);

  return session.parserState;
}
