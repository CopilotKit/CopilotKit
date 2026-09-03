import { isBreach, variancePct as pointVariancePct } from "../data/derive";
import type { Department, LedgerSnapshot, MetricId } from "../data/types";

/**
 * The Metrics Explorer's lever contract — a PURE narrowing over a
 * `LedgerSnapshot`, read straight off the query string so the same four
 * levers (`period`, `department`, `threshold`, `top`) are what a link
 * carries, what a chip could claim, and what the table actually renders.
 *
 * The rule every lever follows, `orders.tsx`'s `parseTopLever` first stated
 * it: a lever that is ABSENT, or set to something this module cannot honour,
 * narrows NOTHING. It must never fall back to a plausible-looking default —
 * that is indistinguishable on screen from a legitimately narrow result, and
 * it is exactly the defect `parseTopLever`'s header describes for `?top=abc`
 * silently becoming "top 1".
 */

/** One point, joined to its metric's label and breach state. */
export interface MetricRow {
  metricId: MetricId;
  label: string;
  department: Department | "all";
  period: string;
  plan: number;
  actual: number;
  variancePct: number;
  breaching: boolean;
}

/** Every value `MetricPoint.department` can carry — the `department` lever's vocabulary. */
const DEPARTMENT_VALUES: readonly (Department | "all")[] = [
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
  "all",
];

/**
 * The `top` lever, parsed exactly the way commerce's `orders.tsx` parses its
 * own (see that file's `parseTopLever`, ~line 122): only a positive integer
 * is honoured. `?top=2.5` is rejected rather than rounded, and `?top=-1` (and
 * `?top=0`) are rejected rather than clamped to 1 — coercing either into a
 * plausible limit is the one-row-queue defect that function's header
 * documents, and reproducing it here would misreport this table's own
 * top-N exactly the same way.
 */
export function parseTopLever(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const digits = raw.trim();
  // Digits only: rejects "", " ", "abc", "-1", "2.5", "1e2", "+5", "10px".
  if (!/^\d+$/.test(digits)) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The rows the Metrics Explorer renders for a given query string.
 *
 * Four levers, each narrowing independently and only when usable:
 *  - `period` — exact match against `MetricPoint.period`. Absent narrows
 *    nothing (every period stays in).
 *  - `department` — exact match against `MetricPoint.department`, validated
 *    against the field's own vocabulary (the four departments plus `"all"`
 *    for company-wide rows). An unrecognised value is the same as absent.
 *  - `threshold` — breaches-only when the raw value is exactly `"1"`.
 *    Anything else (absent, `"0"`, `"true"`, …) narrows nothing.
 *  - `top` — top-N by `|variancePct|`, through `parseTopLever` above. Only
 *    when it resolves to a positive integer does this sort-and-slice; a
 *    dropped `top` leaves the matching rows in point order, unsliced.
 */
export function filterMetricRows(
  searchParams: URLSearchParams,
  snapshot: LedgerSnapshot,
): MetricRow[] {
  const defsById = new Map(snapshot.metricDefs.map((def) => [def.id, def]));
  const period = searchParams.get("period");
  const departmentParam = searchParams.get("department");
  const department =
    departmentParam !== null &&
    (DEPARTMENT_VALUES as readonly string[]).includes(departmentParam)
      ? (departmentParam as Department | "all")
      : null;
  const breachesOnly = searchParams.get("threshold") === "1";
  const top = parseTopLever(searchParams.get("top"));

  const rows: MetricRow[] = [];
  for (const point of snapshot.points) {
    // A point whose metric has no def is unrenderable (no label, no
    // threshold to breach against) rather than a row this table can show.
    const def = defsById.get(point.metricId);
    if (!def) continue;
    if (period !== null && point.period !== period) continue;
    if (department !== null && point.department !== department) continue;

    const breaching = isBreach(def, point);
    if (breachesOnly && !breaching) continue;

    rows.push({
      metricId: point.metricId,
      label: def.label,
      department: point.department,
      period: point.period,
      plan: point.plan,
      actual: point.actual,
      variancePct: pointVariancePct(point),
      breaching,
    });
  }

  if (top === null) return rows;
  // A fresh array: sorting `rows` in place would mutate the very array this
  // function just built (harmless here, but the same discipline `orders.tsx`
  // documents for its own `matching`/`visible` split).
  return [...rows]
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
    .slice(0, top);
}
