// Derived from hashbrown/packages/core/src/magic-text/citations.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Citation extraction for streaming markdown.
 *
 * Extracts citation references like [^1], [^note], etc.
 */

export interface Citation {
  /** The citation label, e.g. "1" or "note" */
  label: string;
  /** The full matched text, e.g. "[^1]" */
  raw: string;
  /** Start index in the original text */
  start: number;
  /** End index in the original text */
  end: number;
}

const CITATION_REGEX = /\[\^([^\]]+)\]/g;

/**
 * Extract all citation references from a text string.
 */
export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  let match: RegExpExecArray | null;

  CITATION_REGEX.lastIndex = 0;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    citations.push({
      label: match[1],
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return citations;
}
