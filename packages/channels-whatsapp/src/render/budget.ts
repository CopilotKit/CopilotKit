/**
 * WhatsApp Cloud API hard limits we clamp against when lowering IR to
 * messages. Sources: Cloud API "Messages" + "Interactive messages" docs.
 */
export const WA_LIMITS = {
  /** Max chars in a text message body. */
  bodyText: 4096,
  /** Max reply buttons in an interactive `button` message. */
  replyButtons: 3,
  /** Max chars in a reply-button title. */
  buttonTitle: 20,
  /** Max chars in an interactive header/body/footer text. */
  interactiveBody: 1024,
  interactiveHeader: 60,
  interactiveFooter: 60,
  /** Max total rows across all sections in an interactive `list` message. */
  listRows: 10,
  /** Max chars in a list-row title. */
  rowTitle: 24,
  /** Max chars in a list-row description. */
  rowDescription: 72,
  /** Max chars in the list's open button label. */
  listButton: 20,
  /** Max chars in an interactive control id (button/row id). */
  controlId: 256,
} as const;

/** Truncate to max chars, appending an ellipsis marker if longer. Never returns >max. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + "…";
}

/** Clamp an array to max items; return kept items plus how many overflowed. */
export function clampArray<T>(
  items: readonly T[],
  max: number,
): { items: T[]; overflow: number } {
  if (items.length <= max) return { items: [...items], overflow: 0 };
  return { items: items.slice(0, max), overflow: items.length - max };
}
