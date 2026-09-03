"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkinHref } from "@/shell/skin-path";
import { useExecLedger } from "../data/ledger-context";
import { execNavTarget } from "../nav-target";
import { filterMetricRows, parseTopLever } from "./metric-rows";
import type { MetricRow } from "./metric-rows";
import type { Department, MetricUnit } from "../data/types";

/**
 * BEAT 3c — the exec skin's lever surface, Metrics Explorer.
 *
 * Four levers — `period`, `department`, `threshold` (breaches-only) and
 * `top` — are read straight off the QUERY STRING via `useSearchParams`,
 * exactly the way commerce's `orders.tsx` reads its own four (see that
 * file's header, ~line 40): this page holds NO lever state of its own, so a
 * typed link, a chip and the agent's own navigation are all the SAME
 * mechanism as a click on one of the controls below.
 *
 * `filterMetricRows` (`./metric-rows`) is the one place the lever semantics
 * live. This page passes the query string straight to it rather than
 * re-implementing any of the four narrowing rules here — which is what keeps
 * these rows in permanent agreement with that module's own tests
 * (`./metrics-explorer.test.tsx`).
 *
 * Every control TINTS the moment its lever is active (`activeControlClass`),
 * mirroring `orders.tsx`'s `activeSelectClass` (~line 173 of that file's
 * `primitives.tsx`): the half of beat 3c that shows the audience the
 * assistant reaching into the app's REAL controls, rather than a page that
 * merely renders filtered rows on faith. Writes go through `execNavTarget`
 * (`../nav-target`) plus `useSkinHref("exec")` — never a hardcoded
 * `/exec/...` path, so the same push works whether this skin is served at
 * `/exec` or, under a `LOCK_SKIN=exec` deploy, at `/`.
 */

const DEPARTMENT_LABEL: Record<Department | "all", string> = {
  manufacturing: "Manufacturing",
  distribution: "Distribution",
  "field-services": "Field services",
  corporate: "Corporate",
  all: "Company-wide",
};

/**
 * The `department` lever's vocabulary, in display order — mirrors
 * `metric-rows.ts`'s own (unexported) `DEPARTMENT_VALUES`. `"all"` is a real,
 * narrowing choice here (company-wide rows only), distinct from leaving the
 * control on "All departments" (no department filter at all).
 */
const DEPARTMENT_OPTIONS: readonly (Department | "all")[] = [
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
  "all",
];

/** The `top` lever's fixed choices. `null` is "no limit". */
const TOP_OPTIONS: readonly (number | null)[] = [null, 5, 10, 25];

const MONTH_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2024-06" → "Jun 2024"; anything else — including a period an agent has
 * navigated to that this snapshot has no data for yet — is passed through
 * unchanged rather than hidden.
 */
function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = MONTH_LABEL[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : period;
}

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * A metric value in its own unit — the same formatting the A2UI catalog
 * renderers use for `usd`/`pct`/`months`/`days`/`score` (see
 * `../catalog/renderers.tsx`'s own `formatValue`), so a figure in this table
 * never disagrees with the same metric rendered on a dashboard tile.
 */
function formatMetricValue(unit: MetricUnit, value: number): string {
  switch (unit) {
    case "usd":
      return usdCompact.format(value);
    case "pct":
      return `${(value * 100).toFixed(1)}%`;
    case "months":
      return `${value.toFixed(1)} mo`;
    case "days":
      return `${value.toFixed(1)} d`;
    case "score":
      return value.toFixed(1);
  }
}

/** Signed variance, matching the CEO dashboard's own `formatVariance` (`./ceo-dashboard.tsx`). */
function formatVariance(value: number): string {
  if (!Number.isFinite(value)) return "— n/a";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

/**
 * A control the AGENT set lights up — tint is per-CONTROL, not per-row (see
 * this page's own header, and `orders.tsx`'s `activeSelectClass`).
 */
function activeControlClass(active: boolean): string {
  return cn(
    "rounded-md border px-2.5 py-1.5 text-[0.78rem] outline-none transition-colors",
    active
      ? "border-brand/50 bg-brand-soft font-semibold text-brand"
      : "border-hairline bg-surface text-ink-muted",
  );
}

export function MetricsExplorerPage() {
  const { snapshot } = useExecLedger();
  const router = useRouter();
  const skinHref = useSkinHref("exec");
  const params = useSearchParams();

  // ── The four levers, read straight off the query string ──────────────────
  const periodParam = params?.get("period") ?? null;
  const departmentParam = params?.get("department") ?? null;
  const threshold = params?.get("threshold") === "1";
  const top = parseTopLever(params?.get("top"));

  // Widened to `readonly string[]` for the membership test — the same
  // widening `orders.tsx` applies to its own status/exception unions
  // (~line 350), for the same reason: `DEPARTMENT_OPTIONS` is a narrow const
  // tuple, so `.includes()` would otherwise refuse the arbitrary query-string
  // value this is validating.
  const department: Department | "all" | null =
    departmentParam !== null &&
    (DEPARTMENT_OPTIONS as readonly string[]).includes(departmentParam)
      ? (departmentParam as Department | "all")
      : null;

  // A fresh, real `URLSearchParams` reconstructed from the query string via
  // `.toString()` — the same pattern `orders.tsx`'s own `setLever` uses
  // (~line 360) — rather than passing `useSearchParams()`'s
  // `ReadonlyURLSearchParams` straight through.
  const searchParams = useMemo(
    () => new URLSearchParams(params?.toString() ?? ""),
    [params],
  );

  // Every period actually present in this snapshot, plus the current
  // `period` lever's value if it names one this window doesn't (yet) carry
  // data for — the select must still be able to SHOW what is selected
  // rather than silently falling back to "All periods".
  const periodOptions = useMemo(() => {
    const values = new Set(snapshot.points.map((point) => point.period));
    if (periodParam !== null) values.add(periodParam);
    return [...values].sort();
  }, [snapshot.points, periodParam]);

  const unitById = useMemo(
    () => new Map(snapshot.metricDefs.map((def) => [def.id, def.unit])),
    [snapshot.metricDefs],
  );

  /**
   * ONE pipeline, TWO published lengths — the same split `orders.tsx`
   * documents for its own `matching`/`visible` (~line 370). `matching` is
   * every row the period/department/threshold levers admit, BEFORE the
   * top-N limit; `rows` is what's actually on screen, after it. Both go
   * through the SAME `filterMetricRows`, so this page can never show a count
   * that pure function itself would disagree with: `matching` calls it again
   * with `top` stripped from a COPY of the query string, rather than
   * re-deriving the limit locally.
   */
  const rows: MetricRow[] = useMemo(
    () => filterMetricRows(searchParams, snapshot),
    [searchParams, snapshot],
  );
  const matching: MetricRow[] = useMemo(() => {
    if (top === null) return rows;
    const withoutTop = new URLSearchParams(searchParams);
    withoutTop.delete("top");
    return filterMetricRows(withoutTop, snapshot);
  }, [searchParams, snapshot, top, rows]);

  /**
   * Every control writes back through here. The current value of every
   * lever it did NOT itself change comes from the query string read above;
   * the one it did change is the override — so a single push always
   * restates the full set of four, and no control can clobber the other
   * three. `null` clears a lever; an absent key leaves it exactly as it was.
   */
  const pushLevers = (
    overrides: Partial<{
      period: string | null;
      department: string | null;
      threshold: boolean;
      top: number | null;
    }>,
  ) => {
    const nextPeriod: string | null =
      "period" in overrides ? (overrides.period ?? null) : periodParam;
    const nextDepartment: string | null =
      "department" in overrides
        ? (overrides.department ?? null)
        : departmentParam;
    const nextThreshold: boolean =
      "threshold" in overrides ? Boolean(overrides.threshold) : threshold;
    const nextTop: number | null =
      "top" in overrides ? (overrides.top ?? null) : top;

    router.push(
      skinHref(
        execNavTarget({
          segment: "metrics",
          period: nextPeriod ?? undefined,
          department: nextDepartment ?? undefined,
          threshold: nextThreshold,
          top: nextTop ?? undefined,
        }),
      ),
    );
  };

  // ── BEAT 3b — which levers the agent set, and what's actually on screen ──
  useAgentContext({
    description:
      "The Metrics Explorer the user is currently viewing. `filters` are " +
      "the active period, department, breaches-only toggle and top-N " +
      "limit, read straight off the query string; `activeLevers` names " +
      "which of those four are actually set right now. `matchingCount` is " +
      "how many rows the period/department/threshold filters admit BEFORE " +
      "the top-N limit, and `showingCount` is how many `rows` remain AFTER " +
      "it — the rows actually on screen, in the order shown.",
    value: JSON.stringify({
      page: "metrics",
      filters: {
        period: periodParam,
        department,
        breachesOnly: threshold,
        top,
      },
      activeLevers: [
        periodParam !== null ? "period" : null,
        department !== null ? "department" : null,
        threshold ? "threshold" : null,
        top !== null ? "top" : null,
      ].filter((lever): lever is string => lever !== null),
      matchingCount: matching.length,
      showingCount: rows.length,
      rows: rows.map((row) => ({
        metric: row.label,
        department: DEPARTMENT_LABEL[row.department],
        period: row.period,
        plan: row.plan,
        actual: row.actual,
        variancePct: row.variancePct,
        breaching: row.breaching,
      })),
    }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Metrics Explorer
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every metric point the ledger tracks, one row per period per
          department.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-hairline bg-surface px-4 py-3 shadow-soft">
        <label className="flex items-center gap-1.5">
          <span className="text-[0.7rem] font-medium text-ink-muted">
            Period
          </span>
          <select
            value={periodParam ?? ""}
            onChange={(event) =>
              pushLevers({ period: event.target.value || null })
            }
            className={activeControlClass(periodParam !== null)}
          >
            <option value="">All periods</option>
            {periodOptions.map((period) => (
              <option key={period} value={period}>
                {formatPeriod(period)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[0.7rem] font-medium text-ink-muted">
            Department
          </span>
          <select
            value={department ?? ""}
            onChange={(event) =>
              pushLevers({ department: event.target.value || null })
            }
            className={activeControlClass(department !== null)}
          >
            <option value="">All departments</option>
            {DEPARTMENT_OPTIONS.map((candidate) => (
              <option key={candidate} value={candidate}>
                {DEPARTMENT_LABEL[candidate]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => pushLevers({ threshold: !threshold })}
          className={activeControlClass(threshold)}
        >
          Breaches only
        </button>

        <label className="flex items-center gap-1.5">
          <span className="text-[0.7rem] font-medium text-ink-muted">Show</span>
          <select
            value={top === null ? "" : String(top)}
            onChange={(event) =>
              pushLevers({
                top: event.target.value ? Number(event.target.value) : null,
              })
            }
            className={activeControlClass(top !== null)}
          >
            {TOP_OPTIONS.map((candidate) => (
              <option
                key={String(candidate)}
                value={candidate === null ? "" : String(candidate)}
              >
                {candidate === null ? "All" : `Top ${candidate}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Numerator and denominator BOTH off the one pipeline above — see
          `matching`/`rows`'s own doc comment. */}
      <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.09em] text-ink-muted">
        {top !== null
          ? `Top ${rows.length} of ${matching.length}`
          : `${rows.length} metric rows`}
      </p>

      <div className="overflow-hidden rounded-xl border border-hairline bg-surface shadow-soft">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">
            No metric rows match these filters.
          </div>
        ) : (
          <table className="w-full text-left text-[0.8rem]">
            <thead>
              <tr className="border-b border-hairline text-[0.68rem] uppercase tracking-[0.08em] text-ink-muted">
                <th className="px-4 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Plan</th>
                <th className="px-4 py-2 text-right font-medium">Actual</th>
                <th className="px-4 py-2 text-right font-medium">Variance</th>
                <th className="px-4 py-2 font-medium">Breach</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unit = unitById.get(row.metricId) ?? "usd";
                return (
                  <tr
                    key={`${row.metricId}-${row.department}-${row.period}`}
                    className="border-b border-hairline last:border-b-0"
                  >
                    <td className="px-4 py-2 font-medium text-ink">
                      {row.label}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {DEPARTMENT_LABEL[row.department]}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {formatPeriod(row.period)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">
                      {formatMetricValue(unit, row.plan)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">
                      {formatMetricValue(unit, row.actual)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums font-medium",
                        row.breaching ? "text-negative" : "text-ink",
                      )}
                    >
                      {formatVariance(row.variancePct)}
                    </td>
                    <td className="px-4 py-2">
                      {row.breaching ? (
                        <span className="inline-flex items-center gap-1 text-[0.72rem] font-medium text-negative">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Breach
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default MetricsExplorerPage;
