/** Convert a finite number or non-empty CSS dimension to a safe fallback. */
export function dimensionToCss(
  value: number | string | undefined,
  fallback: number,
): string {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}px`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return `${fallback}px`;
}
