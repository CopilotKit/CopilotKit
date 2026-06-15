/** Per-element ceilings the Discord API enforces. Degradation is truncate/clamp — never silent drop. */
export const DISCORD_LIMITS = {
  componentsPerMessage: 40, // total components (nested counted) in a Components V2 message
  actionRows: 5,            // action rows per message
  buttonsPerRow: 5,         // buttons per action row
  selectOptions: 25,        // options per string select
  textDisplayChars: 2000,   // chars per TextDisplay
  totalTextChars: 4000,     // summed text across the message
  buttonLabel: 80,          // button label chars
  customId: 100,            // custom_id chars
  headerText: 256,          // header line chars (TextDisplay with `# ` prefix)
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
