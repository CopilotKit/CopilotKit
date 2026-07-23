export const TELEGRAM_LIMITS = {
  messageText: 4096,
  caption: 1024,
  callbackData: 64,
  buttonsPerRow: 8,
  buttonsPerMessage: 100,
  buttonText: 64,
  photosPerMessage: 10,
} as const;

export const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

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
