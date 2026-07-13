const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};
/** Parse "30d" | "12h" | "500ms" | 5000 → milliseconds. Throws on bad input. */
export function parseDuration(input: string | number): number {
  if (typeof input === "number") return input;
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) throw new Error(`Invalid duration: ${input}`);
  return Number(m[1]) * UNITS[m[2]!]!;
}
