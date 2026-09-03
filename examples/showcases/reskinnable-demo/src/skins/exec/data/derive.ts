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
 */
export function isBreach(def: MetricDef, p: MetricPoint): boolean {
  return Math.abs(variancePct(p)) > def.thresholdPct;
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
