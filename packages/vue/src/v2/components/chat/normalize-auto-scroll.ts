export type AutoScrollMode = "pin-to-bottom" | "pin-to-send" | "none";

const VALID: readonly AutoScrollMode[] = [
  "pin-to-bottom",
  "pin-to-send",
  "none",
];

export function normalizeAutoScroll(
  value: AutoScrollMode | boolean | undefined,
): AutoScrollMode {
  if (value === undefined) return "pin-to-bottom";
  if (value === true) return "pin-to-bottom";
  if (value === false) return "none";
  if ((VALID as readonly string[]).includes(value)) return value;
  return "pin-to-bottom";
}
