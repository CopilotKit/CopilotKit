/** Per-element ceilings the Discord API enforces. Degradation is truncate/clamp — never silent drop. */
export const DISCORD_LIMITS = {
  componentsPerMessage: 40, // total components (nested counted) in a Components V2 message
  actionRows: 5, // action rows per message
  buttonsPerRow: 5, // buttons per action row
  selectOptions: 25, // options per string select
  selectPlaceholder: 150, // chars per select placeholder
  textDisplayChars: 2000, // chars per TextDisplay
  totalTextChars: 4000, // summed text across the message
  buttonLabel: 80, // button label chars
  customId: 100, // custom_id chars
  headerText: 256, // header line chars (TextDisplay with `# ` prefix)
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

/**
 * Truncate text that may contain ``` code fences, then re-balance: if truncation
 * left an odd number of fence delimiters (i.e. a fence was cut open), append a
 * closing fence. The result never exceeds `max` — the closing fence is added by
 * trimming further if needed so the total stays within budget.
 */
export function truncateFenced(text: string, max: number): string {
  const truncated = truncateText(text, max);
  const fences = (truncated.match(/```/g) ?? []).length;
  if (fences % 2 === 0) return truncated;
  // A fence was left open. Close it, trimming to keep within `max`.
  const closer = "\n```";
  // If there's no room for even the closer, we can't append a balanced fence
  // without exceeding `max`. Fall back to a plain truncation (no fence append)
  // so the documented "never exceeds max" invariant holds.
  if (max <= closer.length) return truncateText(text, max);
  const room = max - closer.length;
  const body =
    truncated.length > room ? truncated.slice(0, Math.max(0, room)) : truncated;
  return body + closer;
}
