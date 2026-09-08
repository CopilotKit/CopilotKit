// Constructed once at module scope and reused for every call: building an
// `Intl.DateTimeFormat` is the expensive part, so hoisting it keeps the
// per-value cost to a single `.format()`. The `en-US` locale AND explicit `UTC`
// timeZone pins are load-bearing (see the doc comment below), not stylistic.
const stepTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

/**
 * Formats a step's ISO timestamp for the run timeline.
 *
 * Deterministic across environments: a fixed locale (`en-US`) AND an explicit
 * `timeZone` (`UTC`) are pinned so the string is identical whether it is
 * produced during Next.js server rendering (server's locale/timezone) or during
 * browser hydration (viewer's locale/timezone). Without both pins the two
 * renders diverge and React reports a hydration mismatch.
 *
 * Returns `null` for a missing or unparseable timestamp so callers can omit the
 * element entirely.
 */
export function formatStepTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return stepTimeFormatter.format(ms);
}
