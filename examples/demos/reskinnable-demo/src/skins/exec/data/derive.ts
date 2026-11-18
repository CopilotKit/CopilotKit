/**
 * Pure derivations shared by the server (`store.ts`) and the client catalog
 * renderers, so variance is computed identically on both sides.
 *
 * These deliberately import nothing beyond `./types`: no React, no store
 * access. That is what lets the same module be required from a server route
 * AND from a client component without either side dragging in the other's
 * runtime — a variance formula written twice is a variance formula that can
 * drift, and a breach flag is exactly the kind of number that must agree
 * everywhere it appears.
 */

import type { MetricDef, MetricPoint } from "./types";

/**
 * How far actual sits from plan, as a signed fraction of plan.
 *
 * `(actual - plan) / plan` — positive when actual beat plan, negative when it
 * missed. Not clamped and not absolute: `isBreach` below takes the magnitude
 * itself, and a caller that wants direction (a red/green arrow) needs the
 * sign preserved here.
 *
 * NO-VARIANCE-DATA IS A NON-FINITE RESULT, and every consumer has to screen
 * for it. A point planned at zero (or planned at a non-finite value) divides
 * by zero: `±Infinity`, or `NaN` when actual is zero too. There is no number
 * this function could return instead that would not be a guess — a point with
 * no plan has no variance FROM plan — so the honest answer is the one that
 * cannot be mistaken for a measurement, and `Number.isFinite` is the one
 * screen everything downstream applies to it: `isBreach` below, the catalog's
 * `Delta` (which prints "— n/a" rather than "Infinity%"), and
 * `pages/metric-rows.ts`'s ranking comparator (which sorts it last rather
 * than first). Screening matters at every serialization boundary too:
 * `Exception.variancePct` is typed `number`, and `JSON.stringify` writes
 * both `Infinity` and `NaN` as `null`, so an unscreened one reaches the
 * client as a blank where a figure is required.
 */
export function variancePct(p: MetricPoint): number {
  return (p.actual - p.plan) / p.plan;
}

/** As `variancePct`, but against the forecast rather than the plan. */
export function varianceVsForecast(p: MetricPoint): number {
  return (p.actual - p.forecast) / p.forecast;
}

/**
 * Whether a point's variance from plan exceeds its metric's threshold —
 * magnitude only, so a miss and a beat of the same size both breach.
 *
 * A point with NO VARIANCE DATA (see `variancePct` above) never breaches, and
 * that is an explicit refusal rather than whatever the comparison happened to
 * answer. `Math.abs(Infinity) > thresholdPct` is true for EVERY threshold, so
 * a zero-planned point breached permanently: an exception no narrative could
 * ever retire (filing one flips `explained`, never the divide), carrying a
 * `variancePct` that `JSON.stringify` writes as `null` — a blocking breach
 * with a blank figure beside it, sitting in front of the publish gate. Its
 * `NaN` twin answered the opposite, equally unfounded thing: `NaN > x` is
 * false, so a metric with no plan at all was silently in the clear. A
 * variance that cannot be COMPUTED is not a variance that was EXCEEDED, and
 * neither is it a variance that was met — so this reports the only thing the
 * data supports, which is no breach, and leaves the missing plan visible as
 * the "— n/a" the renderers print rather than as a verdict.
 */
export function isBreach(def: MetricDef, p: MetricPoint): boolean {
  const magnitude = Math.abs(variancePct(p));
  if (!Number.isFinite(magnitude)) return false;
  return magnitude > def.thresholdPct;
}

/**
 * The most recent period present in a set of points — "YYYY-MM" strings sort
 * lexicographically in calendar order, so a plain max is exact.
 */
export function latestClosedPeriod(points: MetricPoint[]): string {
  return points.reduce(
    (latest, p) => (p.period > latest ? p.period : latest),
    points[0]?.period ?? "",
  );
}
