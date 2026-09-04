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

/**
 * Every value `MetricPoint.department` can carry — the `department` lever's
 * vocabulary, in display order.
 *
 * EXPORTED, and the one list. `metrics-explorer.tsx` renders its `<select>`
 * straight off this array and `nav-target.ts` validates against it, rather
 * than each keeping a hand-copied twin: two lists that must agree but are
 * written twice drift silently, and the drift is invisible on screen — an
 * option that narrows to nothing, or a department the rows can be filtered by
 * that the control never offers.
 */
export const DEPARTMENT_VALUES: readonly (Department | "all")[] = [
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
 * A period, exactly as `MetricPoint.period` spells one: "YYYY-MM", month
 * 01–12. The same expression `tools.tsx`'s `navigateTo` puts on its own
 * `period` argument, so what the agent is allowed to ask for and what this
 * module can honour are the same set.
 */
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The sentinel every exec lever uses for "leave this one alone". `tools.tsx`
 * maps it back to `undefined` at the call site, but the URL is reachable
 * without going through that mapping (a typed `?period=any`, a copied link),
 * and it must mean the same thing there.
 */
const ANY_SENTINEL = "any";

/**
 * The `period` lever, normalized the same way `department` and `top` already
 * are: a value this module cannot honour is treated as ABSENT rather than as
 * a real (if unusual) filter.
 *
 * `?period=` (or `?period=%20`) used to reach the `period !== null` check
 * below as the literal string `""`, which narrows every row away — no point's
 * `period` is ever the empty string — while still tinting the Metrics
 * Explorer's period control and adding a second, indistinguishable blank
 * option to its select. That is the exact "absent or unusable narrows
 * NOTHING" defect `parseTopLever`'s own header warns against, one lever over:
 * an unusable `period` must leave every row in, the same as an absent one.
 *
 * Three things this must get right, each of which it once got wrong:
 *
 *  - The TRIM REACHES THE RETURN VALUE. This computed `raw.trim()` for the
 *    blank test and then returned the padded `raw`, so `?period=%202026-02`
 *    was honoured verbatim — no point's period carries a leading space, so it
 *    emptied the table while tinting the control and adding a phantom,
 *    visually identical second option to the select. The blank case was the
 *    only one the trim ever fixed.
 *  - SHAPE, not just blankness. Anything that is not a "YYYY-MM" month can
 *    only ever match zero rows, which is the same all-excluding filter under
 *    a different spelling. Unusable is unusable.
 *  - The `"any"` SENTINEL, case-insensitively. `?period=any` is the agent's
 *    way of saying "no period lever"; read literally it is a period no row
 *    has.
 */
export function normalizePeriodLever(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const period = raw.trim();
  if (period === "") return null;
  if (period.toLowerCase() === ANY_SENTINEL) return null;
  return PERIOD_PATTERN.test(period) ? period : null;
}

/**
 * The `department` lever, validated against the field's own vocabulary. An
 * unrecognised value — including the `"any"` sentinel, which is a statement
 * ABOUT the lever rather than a value of it — is the same as absent.
 */
export function normalizeDepartmentLever(
  raw: string | null | undefined,
): Department | "all" | null {
  if (raw === null || raw === undefined) return null;
  return (DEPARTMENT_VALUES as readonly string[]).includes(raw)
    ? (raw as Department | "all")
    : null;
}

/**
 * Top-N's ordering: descending |variance|, with an UNRANKABLE variance last.
 *
 * A point planned at zero divides by zero (`variancePct`, `../data/derive`),
 * giving `Infinity` — or `NaN` when actual is zero too. Subtracting those
 * magnitudes directly, as this did, is wrong twice over: `Infinity` sorts
 * FIRST, so the one row the table renders as "— n/a" leads a list titled
 * "top N by variance"; and `NaN` makes the comparator itself return `NaN`,
 * which is not an ordering at all — the engine is then free to produce any
 * permutation, so which rows survive the slice becomes unpredictable rather
 * than merely odd. A figure that cannot be ranked is not an enormous one.
 *
 * Finite ties return 0 and keep insertion order (`Array.prototype.sort` is
 * stable), so the comparator never invents an order the data doesn't have.
 */
function byVarianceMagnitudeDesc(a: MetricRow, b: MetricRow): number {
  const aMagnitude = Math.abs(a.variancePct);
  const bMagnitude = Math.abs(b.variancePct);
  const aRankable = Number.isFinite(aMagnitude);
  const bRankable = Number.isFinite(bMagnitude);
  if (!aRankable || !bRankable) {
    if (aRankable) return -1;
    if (bRankable) return 1;
    return 0;
  }
  if (aMagnitude === bMagnitude) return 0;
  return bMagnitude - aMagnitude;
}

/**
 * The rows the Metrics Explorer renders for a given query string.
 *
 * Four levers, each narrowing independently and only when usable:
 *  - `period` — exact match against `MetricPoint.period`, through
 *    `normalizePeriodLever` above. Absent, blank, `"any"`, or not a "YYYY-MM"
 *    month narrows nothing (every period stays in).
 *  - `department` — exact match against `MetricPoint.department`, validated
 *    against the field's own vocabulary (the four departments plus `"all"`
 *    for company-wide rows) by `normalizeDepartmentLever`. An unrecognised
 *    value is the same as absent.
 *  - `threshold` — breaches-only when the raw value is exactly `"1"`.
 *    Anything else (absent, `"0"`, `"true"`, …) narrows nothing.
 *  - `top` — top-N by `|variancePct|`, through `parseTopLever` above. Only
 *    when it resolves to a positive integer does this sort-and-slice; a
 *    dropped `top` leaves the matching rows in point order, unsliced. Sorting
 *    is TIED to the limit deliberately: with no `top`, this table is a ledger
 *    listing in point order, and reordering it under the reader would be a
 *    change nothing in the URL asked for.
 */
export function filterMetricRows(
  searchParams: URLSearchParams,
  snapshot: LedgerSnapshot,
): MetricRow[] {
  const defsById = new Map(snapshot.metricDefs.map((def) => [def.id, def]));
  const period = normalizePeriodLever(searchParams.get("period"));
  const department = normalizeDepartmentLever(searchParams.get("department"));
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
  return [...rows].sort(byVarianceMagnitudeDesc).slice(0, top);
}
