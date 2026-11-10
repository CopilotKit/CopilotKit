/**
 * GitHub REST API limits the renderer clamps against. Source: the issue
 * comment and pull request review comment endpoints reject a `body` longer
 * than 65,536 characters.
 */
export const GITHUB_LIMITS = {
  /** Max characters in an issue comment or PR review comment body. */
  commentBody: 65536,
};

/** Appended to text that `truncateText` cut, so readers see the reply is incomplete. */
export const TRUNCATION_MARKER = "\n\n… _(truncated)_";

/**
 * Cut `text` to at most `max` characters. When it cuts, the result ends with
 * {@link TRUNCATION_MARKER}. The result is never longer than `max`.
 *
 * @param text - The Markdown to fit.
 * @param max - The character budget.
 */
export function truncateText(text: string, max: number) {
  if (text.length <= max) return text;
  if (max <= TRUNCATION_MARKER.length) return text.slice(0, max);
  return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
