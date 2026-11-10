import { BOT_MARKER_LENGTH } from "../bot-marker.js";

/** GitHub rejects an issue comment or PR review comment `body` longer than this. */
export const GITHUB_API_COMMENT_BODY_MAX = 65536;

/** GitHub REST API limits the renderer clamps against. */
export const GITHUB_LIMITS = {
  /**
   * Max characters of rendered comment text. The client adds the hidden bot
   * marker, so the text leaves room for it.
   */
  commentBody: GITHUB_API_COMMENT_BODY_MAX - BOT_MARKER_LENGTH,
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
