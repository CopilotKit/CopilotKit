"use client";

/**
 * React renderers for the Vantage (exec) A2UI catalog — one per definition in
 * `./definitions.ts`.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: the agent picks WHAT to show (a query
 * descriptor — metricId/department/compare/months/audience); it never sends a
 * number. Every quantitative figure on screen is read from
 * `useBlockData().snapshot` and computed through `../data/derive`, the same
 * module `../data/store.ts` uses on the server, so a figure in a chat-rendered
 * block and the same figure on a dashboard page can never disagree.
 * `Heading`/`Text` render their label text and nothing else.
 *
 * Charts are hand-rolled SVG (the `src/skins/logistics/components/charts.tsx`
 * precedent) — no chart library.
 */

import { useState } from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "@copilotkit/a2ui-renderer";
import { cn } from "@/lib/utils";
import { useBlockData } from "../block-data";
import {
  isBreach,
  latestClosedPeriod,
  variancePct,
  varianceVsForecast,
} from "../data/derive";
import type {
  DashboardId,
  Department,
  Initiative,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
  MetricUnit,
} from "../data/types";
import type { Definitions } from "./definitions";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props in the catalog are declared `string | { path }` (a data-bound
// ref), but that is the shape the AGENT sends, not the shape a renderer sees:
// the A2UI binder (`GenericBinder`, `@a2ui/web_core`) resolves every dynamic
// prop BEFORE render and hands the renderer the RESOLVED value. A path that
// names nothing in the data model therefore arrives as `undefined` — the
// binder never leaves a standing `{ path }` object behind. So anything that
// is not a string here is a BROKEN BINDING, and `undefined` is its ordinary
// shape; `UnresolvedText` reports whichever shape arrives rather than reading
// into it. (`{ path }` stays in the union for a surface built by hand, past
// the binder — the guard names the path when there is one to name.)
type TextRef = string | { path: string } | undefined;

/** MetricTile's sparkline window — six closed months, per the block spec. */
const SPARKLINE_MONTHS = 6;

/** TrendLine's default window when the agent omits `months`. */
const DEFAULT_TREND_MONTHS = 12;

/** Fixed department order, so a VarianceBar's rows read the same every render. */
const DEPARTMENTS: readonly Department[] = [
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
];

const DEPARTMENT_LABEL: Record<Department | "all", string> = {
  manufacturing: "Manufacturing",
  distribution: "Distribution",
  "field-services": "Field services",
  corporate: "Corporate",
  all: "Company-wide",
};

/**
 * A department's display label, falling back to the RAW KEY.
 *
 * `department` is part of the query descriptor the AGENT sends, so a key
 * outside the four seeded departments is reachable — and it lands on the
 * FAILURE path by construction, since no series exists for it. The map lookup
 * yields `undefined` there, and the failure sentence lower-cases it: the one
 * path that exists to REPORT a bad query used to throw on one, taking the
 * whole A2UI surface down instead of showing the block that could not be
 * built. Printing the raw key also keeps the report answerable — "no data for
 * ... at logistics" names what was actually asked for.
 */
const departmentLabel = (department: string): string =>
  Object.hasOwn(DEPARTMENT_LABEL, department)
    ? DEPARTMENT_LABEL[department as Department | "all"]
    : department;

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

function Slot({ render }: { render: React.ReactNode }) {
  return <>{render}</>;
}

// ── Snapshot queries (selection only — arithmetic lives in ../data/derive) ──

const findDef = (
  snapshot: LedgerSnapshot,
  metricId: MetricId,
): MetricDef | undefined => snapshot.metricDefs.find((d) => d.id === metricId);

/** One metric's points for one department, oldest → newest. */
function seriesFor(
  snapshot: LedgerSnapshot,
  metricId: MetricId,
  department: Department | "all",
): MetricPoint[] {
  // `filter` already returns a fresh array, so sorting it in place cannot
  // reorder the caller's snapshot.
  return snapshot.points
    .filter((p) => p.metricId === metricId && p.department === department)
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

/**
 * The point at a series' LATEST closed period, or `undefined` for an empty
 * series. Reading the latest period rather than the first matching row is the
 * whole point: a tile that reads an earlier period reports a stale beat or
 * miss with full confidence.
 */
function latestPoint(points: MetricPoint[]): MetricPoint | undefined {
  const period = latestClosedPeriod(points);
  return points.find((p) => p.period === period);
}

/**
 * The trailing `months` window as a PERIOD window, not a row slice — the same
 * shape `store.metricSeries` uses, so a window never truncates mid-period for
 * a metric whose rows span several departments.
 */
function lastMonths(points: MetricPoint[], months: number): MetricPoint[] {
  const keep = new Set(
    [...new Set(points.map((p) => p.period))].sort().slice(-months),
  );
  return points.filter((p) => keep.has(p.period));
}

// ── Formatting ─────────────────────────────────────────────────────────────

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A metric value in its own unit. `pct` values are stored as fractions. */
function formatValue(unit: MetricUnit, value: number): string {
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

/** "2026-02" → "Feb 2026"; anything else is passed through unchanged. */
function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = MONTH_LABEL[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : period;
}

// ── Shared presentational pieces ───────────────────────────────────────────

function Tile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/**
 * The explicit failure surface. A block whose query resolves to nothing must
 * SAY so — a silently empty tile is indistinguishable from a block that has
 * not loaded yet, and on a board pack that reads as "no variance" rather than
 * "no data".
 */
function MissingTile({ title, reason }: { title: string; reason: string }) {
  return (
    <div
      data-testid="block-error"
      role="alert"
      className="rounded-2xl border border-negative bg-negative-soft p-4"
    >
      <div className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-negative">
        {title}
      </div>
      <p className="mt-1 text-sm text-ink">{reason}</p>
    </div>
  );
}

/**
 * A text prop that did not resolve to a string — a broken binding (see
 * `TextRef`). The value is read DEFENSIVELY: `undefined` is what the binder
 * passes for an unresolved ref, and reaching into `.path` on it threw a
 * `TypeError` out of the renderer, which takes down the whole A2UI surface
 * instead of the one label that failed to bind.
 */
function UnresolvedText({ label, text }: { label: string; text: unknown }) {
  const path =
    typeof text === "object" && text !== null && "path" in text
      ? (text as { path?: unknown }).path
      : undefined;
  return (
    <MissingTile
      title={`${label} unavailable`}
      reason={
        typeof path === "string"
          ? `Unresolved data reference "${path}" — the text never bound.`
          : "Unresolved data reference — the text never bound."
      }
    />
  );
}

/**
 * Direction glyph + SIGNED delta, per the design skill's variance-first rule:
 * the change is the headline and carries the only colour on the tile; the
 * absolute figure beside it stays neutral ink.
 *
 * `tone` picks WHAT the colour means. The default, "sign", is the reading for
 * a figure that could be good or bad news: green above, red below. "alert" is
 * for a figure already known to be BAD whichever way it went — a point past
 * its metric's threshold, and every row of an `ExceptionList` by construction
 * — where colouring by sign paints an over-plan overrun the same green as an
 * on-plan metric. The CEO dashboard's fixed exception strip
 * (`../pages/ceo-dashboard.tsx`) and the Metrics Explorer's `row.breaching`
 * already follow that rule; `toneFor` below is the same rule, in the block
 * catalog. The sign itself still shows either way.
 *
 * A non-finite delta (variance against a zero plan/forecast) is reported as
 * unavailable rather than rendered as `Infinity%` or `NaN%`.
 */
function Delta({
  value,
  tone = "sign",
}: {
  value: number;
  tone?: "sign" | "alert";
}) {
  if (!Number.isFinite(value)) {
    return <span className="text-sm tabular-nums text-ink-muted">— n/a</span>;
  }
  const glyph = value > 0 ? "▲" : value < 0 ? "▼" : "▬";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "±";
  const signTone =
    value > 0
      ? "text-positive"
      : value < 0
        ? "text-negative"
        : "text-ink-muted";
  return (
    <span
      className={cn(
        "text-sm font-medium tabular-nums",
        tone === "alert" ? "text-negative" : signTone,
      )}
    >
      {glyph} {sign}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

/**
 * The `Delta` tone for a point: "alert" once it is past its metric's
 * threshold, "sign" while it is inside it.
 *
 * Every data-bound renderer that shows a delta beside a figure derived from
 * the SAME point routes through here, so a tile cannot print a green delta
 * next to its own "Breach" chip, and one department's overrun cannot read
 * green on a variance bar while the identical exception reads red on the
 * dashboard strip above it.
 */
function toneFor(def: MetricDef, point: MetricPoint): "sign" | "alert" {
  return isBreach(def, point) ? "alert" : "sign";
}

/**
 * `values` mapped into SVG polyline coordinates over a `w`×`h` box, oldest →
 * newest, against an EXPLICIT `[min, max]` range so two series (actual and
 * plan) can be drawn on one shared scale — the gap between them is then the
 * variance itself. A flat range draws down the middle rather than dividing by
 * zero.
 */
function linePoints(
  values: number[],
  w: number,
  h: number,
  min: number,
  max: number,
): string {
  const span = max - min;
  return values
    .map((v, i) => {
      const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
      const y = span === 0 ? h / 2 : h - ((v - min) / span) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/** A bare six-point trend line, no axes — board-pack sparkline convention. */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full text-brand"
      role="img"
      aria-label={label}
    >
      <polyline
        points={linePoints(
          values,
          100,
          24,
          Math.min(...values),
          Math.max(...values),
        )}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Layout / label-only renderers ──────────────────────────────────────────

const Stack = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
  <div className={cn("flex flex-col", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Heading = ({ props }: RendererProps<{ text: TextRef }>) => {
  if (typeof props.text !== "string") {
    return <UnresolvedText label="Heading" text={props.text} />;
  }
  return (
    <h2 className="text-lg font-semibold tracking-tight text-ink">
      {props.text}
    </h2>
  );
};

/**
 * NOTE — currently unreachable in this app. `buildBlockOps`
 * (`../blocks/build-block-ops.ts`) emits `Stack` + `Heading` + one kind
 * component (+ `AddToDashboard`), and nothing else produces catalog
 * components: no code path emits a `Text`. It stays in the catalog as the
 * neutral-caption primitive the definition describes; see the same note on
 * `Text` in `./definitions.ts`.
 */
const Text = ({
  props,
}: RendererProps<{ text: TextRef; tone?: "default" | "muted" }>) => {
  if (typeof props.text !== "string") {
    return <UnresolvedText label="Text" text={props.text} />;
  }
  return (
    <p
      className={cn(
        "text-sm",
        props.tone === "muted" ? "text-ink-muted" : "text-ink",
      )}
    >
      {props.text}
    </p>
  );
};

// ── Data-bound renderers ───────────────────────────────────────────────────

const MetricTile = ({
  props,
}: RendererProps<{
  metricId: MetricId;
  department?: Department | "all";
  compare?: "plan" | "forecast";
}>) => {
  const { snapshot } = useBlockData();
  const department = props.department ?? "all";
  const def = findDef(snapshot, props.metricId);
  const series = seriesFor(snapshot, props.metricId, department);
  const point = latestPoint(series);

  if (!def || !point) {
    return (
      <MissingTile
        title="Metric unavailable"
        reason={`No data for "${props.metricId}" at ${departmentLabel(department).toLowerCase()}.`}
      />
    );
  }

  const compare = props.compare ?? "plan";
  const delta =
    compare === "forecast" ? varianceVsForecast(point) : variancePct(point);
  const baseline = compare === "forecast" ? point.forecast : point.plan;
  const spark = lastMonths(series, SPARKLINE_MONTHS).map((p) => p.actual);

  return (
    <Tile
      label={`${def.label} · ${departmentLabel(department)} · ${formatPeriod(point.period)}`}
    >
      <div className="flex items-baseline gap-2">
        {/*
          Toned off `isBreach` — the same test the "Breach" chip below is
          drawn from — and NOT off `compare`: the tile reports one point, so
          its delta and its chip have to agree whichever baseline the agent
          asked to compare against.
        */}
        <Delta value={delta} tone={toneFor(def, point)} />
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {formatValue(def.unit, point.actual)}
        </span>
        {isBreach(def, point) && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.1em] text-brand">
            Breach
          </span>
        )}
      </div>
      <div className="mt-1 text-xs tabular-nums text-ink-muted">
        vs {compare} {formatValue(def.unit, baseline)}
      </div>
      <Sparkline
        values={spark}
        label={`${def.label}, last ${spark.length} closed months`}
      />
    </Tile>
  );
};

const TrendLine = ({
  props,
}: RendererProps<{
  metricId: MetricId;
  department?: Department | "all";
  months?: number;
}>) => {
  const { snapshot } = useBlockData();
  const department = props.department ?? "all";
  const def = findDef(snapshot, props.metricId);
  const series = seriesFor(snapshot, props.metricId, department);

  if (!def || series.length === 0) {
    return (
      <MissingTile
        title="Trend unavailable"
        reason={`No data for "${props.metricId}" at ${departmentLabel(department).toLowerCase()}.`}
      />
    );
  }

  // `months` is a QUERY parameter (how much history to fetch), never a value
  // to display — the figures below all come from the points it selects.
  const months = props.months ?? DEFAULT_TREND_MONTHS;
  const trend = lastMonths(series, months);
  const label = `${def.label} · ${departmentLabel(department)} · ${trend.length}mo`;

  if (trend.length < 2) {
    return (
      <Tile label={label}>
        <p className="text-sm text-ink-muted">
          Only one closed period — not enough history to chart a trend.
        </p>
      </Tile>
    );
  }

  // One shared scale across actual AND plan, so the gap between the two lines
  // is the variance rather than an artefact of two independent scales.
  const scale = [...trend.map((p) => p.actual), ...trend.map((p) => p.plan)];
  const min = Math.min(...scale);
  const max = Math.max(...scale);
  const project = (values: number[]) => linePoints(values, 100, 40, min, max);
  const latest = trend[trend.length - 1];

  return (
    <Tile label={label}>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`${def.label} actual against plan, ${trend.length} closed months`}
      >
        <polyline
          points={project(trend.map((p) => p.plan))}
          fill="none"
          className="text-ink-muted"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={project(trend.map((p) => p.actual))}
          fill="none"
          className="text-brand"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs tabular-nums text-ink-muted">
        <span>{formatPeriod(trend[0].period)}</span>
        <span className="flex items-baseline gap-2">
          <Delta value={variancePct(latest)} tone={toneFor(def, latest)} />
          <span className="text-ink">
            {formatValue(def.unit, latest.actual)}
          </span>
        </span>
        <span>{formatPeriod(latest.period)}</span>
      </div>
    </Tile>
  );
};

const VarianceBar = ({ props }: RendererProps<{ metricId: MetricId }>) => {
  const { snapshot } = useBlockData();
  const def = findDef(snapshot, props.metricId);
  // Company-wide ("all") rows are not a department and must never become a
  // fifth bar beside the four real ones.
  const deptPoints = snapshot.points.filter(
    (p) => p.metricId === props.metricId && p.department !== "all",
  );

  // Narrow to the latest closed period BEFORE building rows: without this a
  // 24-month history would render one bar per department PER PERIOD. Walking
  // the fixed department order (rather than the points) is also what keeps it
  // to exactly one row per department whatever the snapshot contains.
  const period = latestClosedPeriod(deptPoints);
  const rows = DEPARTMENTS.map((department) => ({
    department,
    // `undefined` = this department filed nothing for `period`. Kept in the
    // list rather than filtered out: dropping it renders a three-bar chart of
    // a four-department company, where "did not report" is indistinguishable
    // from "is not a department" — and it silently moves the shared `max`
    // below, rescaling every OTHER bar for a reason nothing on screen states.
    point: deptPoints.find(
      (p) => p.period === period && p.department === department,
    ),
  }));
  const reported = rows.filter(
    (row): row is { department: Department; point: MetricPoint } =>
      row.point !== undefined,
  );

  // TWO DIFFERENT FAILURES, TWO DIFFERENT SENTENCES. A missing def is not a
  // metric that filed no departments: the rows may be sitting right there in
  // the snapshot, and what is absent is the definition to label and threshold
  // them against. Reporting the first as the second sends the reader hunting
  // for data that is not the problem.
  if (!def) {
    return (
      <MissingTile
        title="Variance unavailable"
        reason={`No metric definition for "${props.metricId}" on the ledger.`}
      />
    );
  }
  if (reported.length === 0) {
    return (
      <MissingTile
        title="Variance unavailable"
        reason={`"${props.metricId}" has no per-department series to compare.`}
      />
    );
  }

  const max = Math.max(
    ...reported.map((row) => Math.max(row.point.actual, row.point.plan)),
  );
  /**
   * A value's share of the shared scale, in percent, clamped to the track and
   * rounded — a third of the scale is "33.33", not seventeen digits of float.
   */
  const share = (value: number) =>
    Number(
      Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0)).toFixed(2),
    );
  // The bar keeps a 2% MINIMUM so a small-but-real actual still draws
  // something. That floor is a WIDTH, never a position — see `planMarkerStyle`.
  const barWidth = (value: number) => `${Math.max(2, share(value))}%`;
  /**
   * The plan marker's true share of the scale as a POSITION, pulled back by
   * its own width in proportion to how far along it sits. At `left: 100%` the
   * full `translateX(-100%)` keeps the 1px rule inside the `overflow-hidden`
   * track instead of clipping it away.
   */
  const planMarkerStyle = (value: number): React.CSSProperties => {
    const left = `${share(value)}%`;
    return { left, transform: `translateX(-${left})` };
  };

  return (
    <Tile label={`${def.label} · actual vs plan · ${formatPeriod(period)}`}>
      <div className="space-y-3">
        {rows.map(({ department, point }) => (
          <div
            key={department}
            data-testid="variance-bar-row"
            className="space-y-1"
          >
            {point === undefined ? (
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-ink-muted">
                  {DEPARTMENT_LABEL[department]}
                </span>
                <span className="flex-none text-xs text-ink-muted">
                  No data reported
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-ink">
                    {DEPARTMENT_LABEL[department]}
                  </span>
                  <span className="flex flex-none items-baseline gap-2">
                    <Delta
                      value={variancePct(point)}
                      tone={toneFor(def, point)}
                    />
                    <span className="tabular-nums text-ink">
                      {formatValue(def.unit, point.actual)}
                    </span>
                  </span>
                </div>
                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: barWidth(point.actual) }}
                  />
                  {/*
                    THE PLAN MARKER IS A POSITION, NOT A WIDTH. Borrowing the
                    bar's 2% minimum to place it parked the rule at a share of
                    the scale the ledger never held, and sent the LARGEST
                    plan's marker to `left: 100%` — flush against the outside
                    edge of this `overflow-hidden` track, i.e. invisible for
                    exactly the department that sets the scale.

                    A zero (or negative) plan gets NO marker: there is no plan
                    line to draw against, and a rule at the left edge would
                    read as a plan of zero the ledger never filed.
                  */}
                  {point.plan > 0 && (
                    <span
                      aria-hidden
                      data-testid="variance-plan-marker"
                      className="absolute inset-y-0 w-px bg-ink-muted"
                      style={planMarkerStyle(point.plan)}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </Tile>
  );
};

const STATUS_STYLE: Record<Initiative["status"], string> = {
  red: "bg-negative-soft text-negative",
  yellow: "bg-brand-soft text-brand",
  green: "bg-positive-soft text-positive",
};

const InitiativeTable = () => {
  const { snapshot } = useBlockData();
  if (snapshot.initiatives.length === 0) {
    return (
      <MissingTile
        title="Initiatives unavailable"
        reason="No initiatives are on the ledger."
      />
    );
  }
  return (
    <Tile label="Initiatives">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[0.65rem] uppercase tracking-[0.12em] text-ink-muted">
            <th className="pb-2 font-medium">Initiative</th>
            <th className="pb-2 font-medium">Owner</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.initiatives.map((initiative) => (
            <tr key={initiative.id} className="border-t border-hairline">
              <td className="py-2 pr-3 align-top text-ink">
                <div>{initiative.name}</div>
                <div className="text-xs text-ink-muted">{initiative.note}</div>
              </td>
              <td className="py-2 pr-3 align-top text-ink-muted">
                {initiative.owner}
              </td>
              <td className="py-2 align-top">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-[0.1em]",
                    STATUS_STYLE[initiative.status],
                  )}
                >
                  {initiative.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tile>
  );
};

const ExceptionList = ({
  props,
}: RendererProps<{ audience?: "ceo" | "cfo" | "both" }>) => {
  const { snapshot } = useBlockData();

  // NO-DATA IS NOT NO-VARIANCE. Both halves of the ledger are required before
  // this block can say anything: points to read a period off, and defs to
  // classify a breach against (a row whose metric has no def is dropped
  // below). Without either, "no variances" would be a claim the ledger cannot
  // support — the exact conflation `MissingTile` exists to prevent.
  if (snapshot.points.length === 0 || snapshot.metricDefs.length === 0) {
    return (
      <MissingTile
        title="Exceptions unavailable"
        reason={
          snapshot.points.length === 0
            ? "No metric points on the ledger to derive exceptions from."
            : "No metric definitions on the ledger to classify variances against."
        }
      />
    );
  }

  // `snapshot.exceptions` is derived server-side at the latest closed period;
  // re-narrowing here keeps the list honest if a snapshot ever carries more.
  const period = latestClosedPeriod(snapshot.points);
  const audience = props.audience ?? "both";
  const rows = snapshot.exceptions
    .filter((e) => e.period === period)
    .map((e) => ({ exception: e, def: findDef(snapshot, e.metricId) }))
    .filter((row) => {
      if (!row.def) return false;
      if (audience === "both") return true;
      // A metric flagged for "both" audiences belongs on either reader's list.
      return row.def.audience === audience || row.def.audience === "both";
    });

  return (
    <Tile label={`Variances · ${formatPeriod(period)}`}>
      {rows.length === 0 ? (
        // NOT "awaiting explanation": this list carries EXPLAINED rows too
        // (that is what the per-row tag below is for), so an empty list means
        // no variance breached at all — for whoever is reading. Claiming
        // nothing awaits explanation would be a different, and often false,
        // statement about the same ledger.
        <p className="text-sm text-ink-muted">
          {audience === "both"
            ? "No variances this period — every metric is within threshold."
            : `No variances on the ${audience.toUpperCase()}'s list this period.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ exception, def }) => (
            <li
              key={`${exception.metricId}-${exception.department}`}
              className="flex items-baseline justify-between gap-2 text-sm"
            >
              <span className="min-w-0 truncate text-ink">
                {def?.label ?? exception.metricId}
                <span className="text-ink-muted">
                  {" · "}
                  {DEPARTMENT_LABEL[exception.department]}
                </span>
              </span>
              <span className="flex flex-none items-baseline gap-2">
                {/*
                  `tone="alert"`: every row here is a BREACH by construction —
                  `store.exceptions()` only emits points past `isBreach`'s
                  threshold, in either direction — so the colour says "this
                  breached", never "this was positive". Colouring by sign
                  painted an over-plan overrun green in this list while the CEO
                  dashboard's strip painted the same exception red directly
                  above it.
                */}
                <Delta value={exception.variancePct} tone="alert" />
                <span className="text-xs text-ink-muted">
                  {exception.explained ? "explained" : "unexplained"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
};

/**
 * The pin control.
 *
 * Once the block is pinned, the WHOLE control collapses to a single "Pinned ✓"
 * — not a per-button flip. That is a semantic requirement, not a styling
 * choice: pinning is single-home, so `store.addBlockToDashboard` refuses a
 * second pin to the other dashboard with `ALREADY_PINNED`. Offering a
 * still-live second button after a successful pin would advertise an action
 * that cannot succeed.
 *
 * Pinned-ness is read ONLY from `isPinned` — the ledger snapshot, derived
 * fresh (see `../providers.tsx`'s `BlockDataBridge`) — never mirrored into
 * local state. This control stays mounted in the transcript for the whole
 * conversation, so it outlives the pin: `store.removeBlock` returns the block
 * to `drafts`, at which point a re-pin genuinely succeeds and these buttons
 * must come back. A local `pinned` flag set on success never cleared, leaving
 * "Pinned ✓" over an unpinned block with no route back.
 */
const AddToDashboard = ({ props }: RendererProps<{ blockId: string }>) => {
  const { addBlock, isPinned } = useBlockData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `addBlock` awaits the ledger refresh before resolving, so by the time a
  // pin's `await` returns, `isPinned` already reports the new truth.
  if (isPinned(props.blockId)) {
    return (
      <div className="text-sm font-medium text-positive" role="status">
        Pinned ✓
      </div>
    );
  }

  const pin = async (dashboardId: DashboardId) => {
    setBusy(true);
    setError(null);
    try {
      await addBlock(dashboardId, props.blockId);
    } catch (e) {
      // Loud: a pin that failed must never look like a pin that worked. The
      // message carries the server's code and the dashboard involved.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buttonClass =
    "rounded-full border border-hairline bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface-muted disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className={buttonClass}
        onClick={() => void pin("ceo")}
      >
        Pin to CEO dashboard
      </button>
      <button
        type="button"
        disabled={busy}
        className={buttonClass}
        onClick={() => void pin("cfo")}
      >
        Pin to CFO dashboard
      </button>
      {error !== null && (
        <span role="alert" className="text-xs text-negative">
          Could not pin: {error}
        </span>
      )}
    </div>
  );
};

export const renderers = {
  Stack,
  Heading,
  Text,
  MetricTile,
  TrendLine,
  VarianceBar,
  InitiativeTable,
  ExceptionList,
  AddToDashboard,
} satisfies CatalogRenderers<Definitions>;
