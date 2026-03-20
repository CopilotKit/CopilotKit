// Derived from hashbrown/packages/core/src/magic-text/segments.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/**
 * Intl.Segmenter-based text segmentation for streaming markdown.
 *
 * Uses grapheme-cluster segmentation to correctly handle multi-byte
 * characters, emoji, and other complex Unicode sequences.
 */

let _segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter {
  if (!_segmenter) {
    _segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  }
  return _segmenter;
}

/**
 * Segment text into an array of grapheme clusters.
 * Falls back to Array.from if Intl.Segmenter is not available.
 */
export function segmentText(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = getSegmenter();
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  // Fallback for environments without Intl.Segmenter
  return Array.from(text);
}
