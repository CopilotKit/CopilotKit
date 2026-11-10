/**
 * Notion comment limits the renderer clamps against. Sources: Notion API
 * "Rich text" and "Request limits" reference pages.
 */
export const NOTION_LIMITS = {
  /** Max characters in one rich text item's `text.content`. */
  richTextContent: 2000,
  /** Max rich text items in one `rich_text` array. */
  richTextItems: 100,
  /**
   * Adapter budget for the visible text of one comment. Notion allows more
   * (100 items of 2000 characters), but a comment this long is already hard to
   * read, and every streamed edit re-sends the whole comment.
   */
  commentText: 16_000,
} as const;

/** Truncate to `max` characters, ending with "…" when cut. Never returns more than `max`. */
export function truncateText(text: string, max: number) {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + "…";
}
