export const GCHAT_LIMITS = {
  cardsPerMessage: 100,
  widgetsPerCard: 100,
  headerText: 200,
  textParagraph: 4000,
  buttonText: 40,
  buttonsPerSet: 6,
  decoratedTextTop: 4000,
} as const;

/** Truncate to max chars, appending an ellipsis marker if the input was longer. Never returns >max. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + "…"; // …
}

/** Clamp an array to max items; return the kept items plus how many overflowed (for an overflow signal). */
export function clampArray<T>(
  items: readonly T[],
  max: number,
): { items: T[]; overflow: number } {
  if (items.length <= max) return { items: [...items], overflow: 0 };
  return { items: items.slice(0, max), overflow: items.length - max };
}
