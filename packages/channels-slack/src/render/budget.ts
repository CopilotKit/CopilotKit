export const SLACK_LIMITS = {
  blocksPerMessage: 50,
  sectionText: 3000,
  headerText: 150,
  fieldsPerSection: 10,
  fieldText: 2000,
  actionsElements: 25,
  contextElements: 10,
  buttonText: 75,
  actionId: 255,
  buttonValue: 2000,
  selectOptions: 100,
  tableColumns: 20,
  tableRows: 100,
  cellText: 2000,
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
