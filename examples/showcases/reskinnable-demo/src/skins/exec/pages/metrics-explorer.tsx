"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { cn } from "@/lib/utils";
import { useSkinHref } from "@/shell/skin-path";
import { useExecLedger } from "../data/ledger-context";
import {
  filterMetricRows,
  normalizePeriodLever,
  parseTopLever,
} from "./metric-rows";
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
 * merely renders filtered rows on faith. Writes go through `pushLevers`
 * (below, built on `nextLeverSearchParams`) plus `useSkinHref("exec")` —
 * never a hardcoded `/exec/...` path, so the same push works whether this
 * skin is served at `/exec` or, under a `LOCK_SKIN=exec` deploy, at `/`.
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

/**
 * Every lever this page pushes back, restated as one bag — the shape
 * `nextLeverSearchParams` and `pushLevers` below both key off.
 *
 * `department` is the VALIDATED value here (membership-checked against
 * `DEPARTMENT_OPTIONS`, as computed below) — this is what `current` is built
 * from. An override, by contrast, carries whatever RAW string a `<select>`'s
 * `onChange` hands over (see `LeverOverrides`), which is why the two are
 * separate types rather than one.
 */
interface LeverState {
  period: string | null;
  department: Department | "all" | null;
  threshold: boolean;
  top: number | null;
}

/** What a single control push can override — a raw, unvalidated `department`. */
interface LeverOverrides {
  period?: string | null;
  department?: string | null;
  threshold?: boolean;
  top?: number | null;
}

/**
 * The pure builder behind `pushLevers` below — factored out so the three
 * rules it has to hold are directly testable without mounting the page
 * (`./metrics-explorer.test.tsx`):
 *
 *  - UNRELATED params survive. `base` is a CLONE of the full current query
 *    string, and only the four known lever keys are ever set or deleted on
 *    it — the same discipline `orders.tsx`'s `setLever` applies to its own
 *    writeback (~line 360). This used to rebuild the query from just the four
 *    levers via `execNavTarget`, which is right for a FRESH navigation (a
 *    chip, an exception-feed link) that owns its whole target, but wrong for
 *    a lever push: any param this page's four levers don't own — added by
 *    another surface, or by a link carrying its own tracking params — was
 *    silently dropped on the very next click.
 *  - `department` is restated at its VALIDATED value (`current.department`,
 *    already membership-checked against `DEPARTMENT_OPTIONS`) whenever the
 *    push doesn't itself touch that lever — never the raw query string. An
 *    unrecognised `?department=bogus` this page was reached with used to
 *    survive every OTHER control's click forever, unlike `top`/`threshold`,
 *    which already restate their PARSED values.
 *  - `top`/`threshold` keep restating their PARSED values, as before.
 */
export function nextLeverSearchParams(
  base: URLSearchParams,
  current: LeverState,
  overrides: LeverOverrides,
): URLSearchParams {
  const next = new URLSearchParams(base);

  const nextPeriod =
    "period" in overrides ? (overrides.period ?? null) : current.period;
  if (nextPeriod) next.set("period", nextPeriod);
  else next.delete("period");

  const nextDepartment =
    "department" in overrides
      ? (overrides.department ?? null)
      : current.department;
  if (nextDepartment) next.set("department", nextDepartment);
  else next.delete("department");

  const nextThreshold =
    "threshold" in overrides ? Boolean(overrides.threshold) : current.threshold;
  if (nextThreshold) next.set("threshold", "1");
  else next.delete("threshold");

  const nextTop = "top" in overrides ? (overrides.top ?? null) : current.top;
  if (nextTop !== null) next.set("top", String(nextTop));
  else next.delete("top");

  return next;
}

export function MetricsExplorerPage() {
  const { snapshot } = useExecLedger();
  const router = useRouter();
  const skinHref = useSkinHref("exec");
  const params = useSearchParams();

  // ── The four levers, read straight off the query string ──────────────────
  // `period` is normalized through `normalizePeriodLever` — a blank or
  // whitespace-only `?period=` is treated as absent rather than as a real
  // (all-excluding) filter, matching how `department`/`top` already treat an
  // unusable value as no lever at all (see that function's header).
  const periodParam = normalizePeriodLever(params?.get("period"));
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

  /**
   * `TOP_OPTIONS`, plus the current `top` value when the agent's own
   * `navigateTo` landed on a value outside that fixed vocabulary (any
   * positive integer, e.g. `?top=7`) — the same "show what's actually
   * selected" rule `periodOptions` above already applies. Without this the
   * `<select>` has no matching `<option>` for the active value, so it renders
   * BLANK — no label at all — even though the rows are genuinely sliced to 7
   * and the control tints, which reads as a broken control rather than a
   * legitimately unusual one.
   */
  const topOptions = useMemo(() => {
    if (top !== null && !(TOP_OPTIONS as readonly (number | null)[]).includes(top)) {
      return [...TOP_OPTIONS, top].sort((a, b) => {
        if (a === null) return -1;
        if (b === null) return 1;
        return a - b;
      });
    }
    return TOP_OPTIONS;
  }, [top]);

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
   * Every control writes back through here, via the pure `nextLeverSearchParams`
   * above. The current value of every lever it did NOT itself change comes
   * from the (validated/parsed) values read above — `department` restates
   * its VALIDATED form, never the raw query string — so a single push always
   * restates the full set of four, and no control can clobber the other
   * three, an unrelated param, or an unrecognised department that snuck in.
   * `null` clears a lever; an absent key leaves it exactly as it was.
   */
  const pushLevers = (overrides: LeverOverrides) => {
    const next = nextLeverSearchParams(
      searchParams,
      { period: periodParam, department, threshold, top },
      overrides,
    );
    const query = next.toString();
    router.push(skinHref(`metrics${query ? `?${query}` : ""}`));
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
            {topOptions.map((candidate) => (
              <option
                key={String(candidate)}
                value={candidate === null ? "" : String(candidate)}
              >
                {candidate === null
                  ? "All"
                  : (TOP_OPTIONS as readonly (number | null)[]).includes(
                        candidate,
                      )
                    ? `Top ${candidate}`
                    : `${candidate} (from chat)`}
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
