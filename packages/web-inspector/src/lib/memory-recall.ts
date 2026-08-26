import type { Memory } from "@copilotkit/core";

// ─── memory recall relevance helpers ─────────────────────────────────────────

/**
 * Normalizes a memory's raw recall score to a 0..1 relevance ratio relative to
 * the strongest result in the same result set. Recall scores are RRF scores
 * (relative), so a bar is only meaningful against the set max. Returns
 * `undefined` when no meaningful ranking exists (empty set, non-positive max,
 * missing score) so the caller renders no bar.
 */
export function normalizeRelevance(
  score: number | undefined,
  maxScore: number,
): number | undefined {
  if (maxScore <= 0) return undefined;
  if (score === undefined || !Number.isFinite(score)) return undefined;
  const ratio = score / maxScore;
  if (ratio <= 0) return 0;
  return ratio > 1 ? 1 : ratio;
}

/** Largest finite `score` across a result set, or 0 when none present. */
export function maxRecallScore(memories: readonly Memory[]): number {
  let max = 0;
  for (const m of memories) {
    const s = m.score;
    if (typeof s === "number" && Number.isFinite(s) && s > max) max = s;
  }
  return max;
}

/**
 * Percent width for a relevance bar. Mirrors the banking reference
 * (`max(6, round(rel*100))%`) so a matched-but-weak result still shows a sliver.
 * Returns a whole number in [6, 100].
 */
export function relevanceBarWidth(relevance: number): number {
  return Math.max(6, Math.min(100, Math.round(relevance * 100)));
}

export {
  normalizeRelevance as ɵnormalizeRelevance,
  maxRecallScore as ɵmaxRecallScore,
  relevanceBarWidth as ɵrelevanceBarWidth,
};

// ─── cpk-memory-list ─────────────────────────────────────────────────────────
