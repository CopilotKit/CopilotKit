/**
 * Adaptive Card payload limits for Teams.
 *
 * Teams caps an Adaptive Card attachment at ~28 KB of JSON and renders only a
 * handful of top-level actions comfortably. These ceilings keep a rendered card
 * inside those bounds; the renderer clamps collections and truncates text to
 * them rather than emitting an oversized card Teams would reject.
 */
export const TEAMS_LIMITS = {
  /** Top-level body elements (TextBlocks, FactSets, Tables, etc.) per card. */
  bodyElements: 100,
  /** Top-level `Action.Submit`s. Teams shows ~6 before overflowing. */
  actions: 6,
  /** Characters of text in a single TextBlock. */
  textBlock: 12000,
  factTitle: 200,
  factValue: 2000,
  factsPerSet: 50,
  buttonText: 256,
  tableColumns: 12,
  tableRows: 100,
  cellText: 2000,
  choices: 100,
  choiceLabel: 256,
  /** Data points (categories / slices) in a single chart. */
  chartDataPoints: 50,
  /** Characters of a chart title or a data point's label. */
  chartTitle: 200,
  chartLabel: 200,
} as const;

/** Truncate to `max` chars, appending an ellipsis if the input was longer. Never returns >max. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return text.slice(0, max - 1) + "…";
}

/** Clamp an array to `max` items; return the kept items plus how many overflowed. */
export function clampArray<T>(
  items: readonly T[],
  max: number,
): { items: T[]; overflow: number } {
  if (items.length <= max) return { items: [...items], overflow: 0 };
  return { items: items.slice(0, max), overflow: items.length - max };
}
