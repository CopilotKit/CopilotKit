// Derived from hashbrown/packages/react/src/hooks/use-magic-text-parser.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * React hook for managing streaming markdown parser state.
 *
 * Provides a simple API: { blocks, feed(chunk), reset() }
 *
 * Handles prefix-only incremental parsing — when new text arrives,
 * only the new portion is fed to the parser, making it efficient
 * for streaming use cases.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import type { Block, MagicTextParserState } from "@copilotkitnext/core";
import {
  createMagicTextParserState,
  parseMagicTextChunk,
  finalizeMagicText,
} from "@copilotkitnext/core";

export interface UseMagicTextParserResult {
  /** The current block tree — ready for rendering */
  blocks: Block[];
  /**
   * Feed a chunk of text to the parser.
   * Call this as streaming chunks arrive.
   */
  feed: (chunk: string) => void;
  /**
   * Feed the full text so far (prefix-mode).
   * The hook tracks how much has already been parsed and only
   * feeds the new suffix to the parser.
   */
  feedFullText: (fullText: string) => void;
  /**
   * Finalize the parser — call when the stream is complete.
   */
  finalize: () => void;
  /** Reset the parser to its initial state. */
  reset: () => void;
  /** Total characters consumed */
  consumed: number;
}

/**
 * Hook for managing streaming markdown parser state.
 *
 * @example
 * ```tsx
 * const { blocks, feed, finalize, reset } = useMagicTextParser();
 *
 * // As streaming chunks arrive:
 * feed(chunk);
 *
 * // When stream completes:
 * finalize();
 *
 * // Render:
 * <MagicTextRenderer blocks={blocks} />
 * ```
 */
export function useMagicTextParser(): UseMagicTextParserResult {
  const [state, setState] = useState<MagicTextParserState>(() =>
    createMagicTextParserState(),
  );

  // Track the last known full-text length for prefix-mode parsing
  const lastLengthRef = useRef(0);

  const feed = useCallback((chunk: string) => {
    setState((prev) => parseMagicTextChunk(prev, chunk));
  }, []);

  const feedFullText = useCallback((fullText: string) => {
    const prevLength = lastLengthRef.current;
    if (fullText.length > prevLength) {
      const newChunk = fullText.substring(prevLength);
      lastLengthRef.current = fullText.length;
      setState((prev) => parseMagicTextChunk(prev, newChunk));
    }
  }, []);

  const finalize = useCallback(() => {
    setState((prev) => finalizeMagicText(prev));
  }, []);

  const reset = useCallback(() => {
    lastLengthRef.current = 0;
    setState(createMagicTextParserState());
  }, []);

  return useMemo(() => ({
    blocks: state.blocks,
    feed,
    feedFullText,
    finalize,
    reset,
    consumed: state.consumed,
  }), [state, feed, feedFullText, finalize, reset]);
}
