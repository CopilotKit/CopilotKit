import type {
  Compare,
  Db,
  Dimension,
  FactRow,
  Lens,
  MetricId,
  PeriodId,
  Region,
} from "./types";

/**
 * Every metric in Vantage is DERIVED here from the seeded fact table — nothing
 * is precomputed and stored. That is deliberate: the demo's third beat turns on
 * the five query levers (period, comparison, segment, grain, currency) genuinely
 * recomputing, and canned per-question answers would make "why did EMEA slip?"
 * a fancy link rather than a maneuver through real controls.
 *
 * Pure and server-safe: no React, no fetch, no module state.
 */

const GROSS_MARGIN = 0.79;

const monthIndex = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
};
const monthFromIndex = (index: number): string =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
const shift = (month: string, by: number): string =>
  monthFromIndex(monthIndex(month) + by);
const range = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, i) => shift(from, i));

const PERIOD_START: Record<PeriodId, { from: string; count: number }> = {
  "q1-2026": { from: "2026-01", count: 3 },
  "q2-2026": { from: "2026-04", count: 3 },
  "q3-2026": { from: "2026-07", count: 3 },
  "h1-2026": { from: "2026-01", count: 6 },
  ttm: { from: "2025-10", count: 12 },
};

export function monthsIn(period: PeriodId): string[] {
  const { from, count } = PERIOD_START[period];
  return range(from, count);
}

export function comparisonMonths(
  period: PeriodId,
  compare: Compare,
): string[] | null {
  // vs-plan's baseline lives in the plan table, not in a shifted fact window.
  if (compare === "vs-plan") return null;
  const months = monthsIn(period);
  const back = compare === "yoy" ? 12 : months.length;
  return months.map((m) => shift(m, -back));
}

const QUARTER_LABEL = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return `Q${Math.floor((m - 1) / 3) + 1} ${String(y).slice(2)}`;
};
const MONTH_NAMES = [
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
const MONTH_LABEL = (month: string): string => {
  const [, m] = month.split("-").map(Number);
  return MONTH_NAMES[m - 1];
};

const REGION_LABEL: Record<Region, string> = {
  namer: "NAMER",
  emea: "EMEA",
  apac: "APAC",
};
const SEGMENT_LABEL: Record<string, string> = {
  enterprise: "Enterprise",
  "mid-market": "Mid-market",
  smb: "SMB",
};
const CHANNEL_LABEL: Record<string, string> = {
  direct: "Direct",
  partner: "Partner",
  "self-serve": "Self-serve",
};

/** reported → constant. NAMER's rate is 1, so it is a no-op there. */
function fxRate(db: Db, month: string, region: Region): number {
  return db.fx.find((f) => f.month === month && f.region === region)?.rate ?? 1;
}

function factsFor(db: Db, lens: Lens, months: string[]): FactRow[] {
  const wanted = new Set(months);
  return db.facts.filter(
    (f) =>
      wanted.has(f.month) &&
      (lens.segment === "all" || f.segment === lens.segment) &&
      (lens.region === "all" || f.region === lens.region),
  );
}

interface Agg {
  newArr: number;
  expansionArr: number;
  churnedArr: number;
  startingArr: number;
  pipelineCreated: number;
  salesSpend: number;
  customers: number;
  churnedCustomers: number;
  monthCount: number;
}

function aggregate(db: Db, lens: Lens, months: string[]): Agg {
  const rows = factsFor(db, lens, months);
  const first = months[0];
  const scale = (row: FactRow, value: number) =>
    lens.currency === "constant"
      ? value * fxRate(db, row.month, row.region)
      : value;

  const agg: Agg = {
    newArr: 0,
    expansionArr: 0,
    churnedArr: 0,
    startingArr: 0,
    pipelineCreated: 0,
    salesSpend: 0,
    customers: 0,
    churnedCustomers: 0,
    monthCount: months.length,
  };
  for (const row of rows) {
    agg.newArr += scale(row, row.newArr);
    agg.expansionArr += scale(row, row.expansionArr);
    agg.churnedArr += scale(row, row.churnedArr);
    agg.pipelineCreated += scale(row, row.pipelineCreated);
    agg.salesSpend += scale(row, row.salesSpend);
    agg.churnedCustomers += row.churnedCustomers;
    // Stock (not flow) measures come from the FIRST month only — summing a
    // balance across months would multiply it by the window length.
    if (row.month === first) {
      agg.startingArr += scale(row, row.startingArr);
      agg.customers += row.customers;
    }
  }
  return agg;
}

function metricValue(metric: MetricId, agg: Agg): number {
  const netNew = agg.newArr + agg.expansionArr - agg.churnedArr;
  switch (metric) {
    case "arr":
      return agg.startingArr + netNew;
    case "nrr":
      return agg.startingArr
        ? (agg.startingArr + agg.expansionArr - agg.churnedArr) /
            agg.startingArr
        : 0;
    case "pipeline_coverage":
      return agg.newArr ? agg.pipelineCreated / agg.newArr : 0;
    case "cac_payback":
      return agg.newArr
        ? (agg.salesSpend / (agg.newArr * GROSS_MARGIN)) * 12
        : 0;
    case "logo_churn":
      return agg.customers
        ? (agg.churnedCustomers / agg.customers) * (12 / agg.monthCount)
        : 0;
    case "magic_number":
      return agg.salesSpend ? netNew / agg.salesSpend : 0;
  }
}

const definitionFor = (db: Db, metric: MetricId) => {
  const def = db.metrics.find((m) => m.id === metric);
  if (!def) throw new Error(`Unknown metric: ${metric}`);
  return def;
};

/** The plan table is a company-wide NET-NEW ARR plan, one row per month. */
const plannedNetNew = (db: Db, months: string[]): number =>
  db.plan
    .filter((p) => months.includes(p.month))
    .reduce((sum, p) => sum + p.planArr, 0);

/**
 * The plan ARR LEVEL the lens is accountable for: the ARR base it entered the
 * window with, plus its share of the planned net-new.
 *
 * Two things matter here and both are easy to get wrong:
 *
 * 1. `planArr` is planned NET-NEW ARR, while `metricValue("arr")` is an ARR
 *    LEVEL. Comparing the two directly is a units error that reports a ~+400%
 *    beat against a plan the company is in fact missing.
 * 2. The plan share must be allocated on something INDEPENDENT of the window's
 *    actuals. Allocating it by each region's share of actual net-new is
 *    degenerate — every region then lands at the identical attainment ratio, so
 *    no region can ever be shown to have missed by more than another, and the
 *    variance waterfall has nothing to attribute.
 *
 * So the plan is allocated by share of the ARR base at the start of the window.
 * Dividing by the REPORTED total keeps the constant-currency lens honest: the
 * numerator carries the lens currency, so plan and actual move together and
 * flipping the currency toggle cannot manufacture a miss.
 */
function planLevel(db: Db, lens: Lens, months: string[]): number {
  const scopedStart = aggregate(db, lens, months).startingArr;
  const totalStart = aggregate(
    db,
    { ...lens, region: "all", segment: "all", currency: "reported" },
    months,
  ).startingArr;
  if (!totalStart) return 0;
  return scopedStart + plannedNetNew(db, months) * (scopedStart / totalStart);
}

function buckets(
  months: string[],
  grain: Lens["grain"],
): { label: string; months: string[] }[] {
  if (grain === "monthly") {
    return months.map((m) => ({ label: MONTH_LABEL(m), months: [m] }));
  }
  const out: { label: string; months: string[] }[] = [];
  for (const month of months) {
    const label = QUARTER_LABEL(month);
    const existing = out.find((b) => b.label === label);
    if (existing) existing.months.push(month);
    else out.push({ label, months: [month] });
  }
  return out;
}

export interface SeriesPoint {
  label: string;
  value: number;
}
export interface Comparison {
  basis: Compare;
  baselineLabel: string;
  baseline: number;
  delta: number;
  deltaPct: number;
}
export interface SeriesResult {
  metric: MetricId;
  label: string;
  unit: "usd" | "ratio" | "pct" | "months";
  lens: Lens;
  points: SeriesPoint[];
  total: number;
  comparison: Comparison | null;
}

export function computeSeries(
  db: Db,
  lens: Lens,
  metric: MetricId,
): SeriesResult {
  const def = definitionFor(db, metric);
  const months = monthsIn(lens.period);
  const points = buckets(months, lens.grain).map((bucket) => ({
    label: bucket.label,
    value: metricValue(metric, aggregate(db, lens, bucket.months)),
  }));
  const total = metricValue(metric, aggregate(db, lens, months));

  let comparison: Comparison | null = null;
  if (lens.compare === "vs-plan") {
    // Only a currency amount can be compared to a plan number.
    const baseline = def.unit === "usd" ? planLevel(db, lens, months) : 0;
    if (baseline) {
      comparison = {
        basis: "vs-plan",
        baselineLabel: "Plan",
        baseline,
        delta: total - baseline,
        deltaPct: (total - baseline) / baseline,
      };
    }
  } else {
    const baseMonths = comparisonMonths(lens.period, lens.compare);
    if (baseMonths) {
      const baseline = metricValue(metric, aggregate(db, lens, baseMonths));
      if (baseline) {
        comparison = {
          basis: lens.compare,
          baselineLabel: lens.compare === "yoy" ? "Year ago" : "Prior period",
          baseline,
          delta: total - baseline,
          deltaPct: (total - baseline) / baseline,
        };
      }
    }
  }
  return {
    metric,
    label: def.label,
    unit: def.unit,
    lens,
    points,
    total,
    comparison,
  };
}

export const DEFAULT_KPIS: MetricId[] = [
  "arr",
  "pipeline_coverage",
  "cac_payback",
  "logo_churn",
];

/**
 * Resolve an explicit `metrics=a,b` selection against the certified catalog.
 *
 * Unknown ids are DROPPED rather than passed on: `definitionFor` throws on one,
 * so forwarding a typo would turn a query-string mistake into a 500. An empty
 * or absent selection falls back to DEFAULT_KPIS, which keeps every existing
 * caller (the pages, the KPI-row gen-UI card) on exactly the four tiles it had.
 */
export function resolveMetricIds(
  db: Db,
  raw: string | null | undefined,
): MetricId[] {
  if (!raw) return DEFAULT_KPIS;
  const certified = new Set<string>(db.metrics.map((m) => m.id));
  const picked = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id): id is MetricId => certified.has(id));
  return picked.length ? picked : DEFAULT_KPIS;
}

export interface KpiResult {
  metric: MetricId;
  label: string;
  unit: "usd" | "ratio" | "pct" | "months";
  value: number;
  delta: number;
  deltaPct: number;
  sparkline: number[];
}

export function computeKpis(
  db: Db,
  lens: Lens,
  metrics: MetricId[] = DEFAULT_KPIS,
): KpiResult[] {
  return metrics.map((metric) => {
    // The sparkline always reads monthly regardless of the lens grain — a
    // two-point spark is not a spark.
    const series = computeSeries(db, { ...lens, grain: "monthly" }, metric);
    return {
      metric,
      label: series.label,
      unit: series.unit,
      value: series.total,
      delta: series.comparison?.delta ?? 0,
      deltaPct: series.comparison?.deltaPct ?? 0,
      sparkline: series.points.map((p) => p.value),
    };
  });
}

export interface WaterfallStep {
  label: string;
  value: number;
  kind: "start" | "delta" | "end";
}

/**
 * Plan → per-region variance → actual. The deltas reconcile start to end
 * exactly, which is what makes the chart readable as an explanation rather than
 * a decoration.
 */
export function computeVarianceWaterfall(db: Db, lens: Lens): WaterfallStep[] {
  const months = monthsIn(lens.period);
  const regions: Region[] = ["namer", "emea", "apac"];
  const start = planLevel(db, { ...lens, region: "all" }, months);
  const deltas = regions.map((region) => {
    const scoped: Lens = { ...lens, region };
    return {
      label: REGION_LABEL[region],
      value:
        metricValue("arr", aggregate(db, scoped, months)) -
        planLevel(db, scoped, months),
      kind: "delta" as const,
    };
  });
  const end = start + deltas.reduce((sum, d) => sum + d.value, 0);
  return [
    { label: "Plan", value: start, kind: "start" },
    ...deltas,
    { label: "Actual", value: end, kind: "end" },
  ];
}

export interface BreakdownRow {
  key: string;
  label: string;
  value: number;
  share: number;
}

export function computeBreakdown(
  db: Db,
  lens: Lens,
  metric: MetricId,
  dimension: Dimension,
): BreakdownRow[] {
  const months = monthsIn(lens.period);
  const keys = [...new Set(db.facts.map((f) => f[dimension]))] as string[];
  const labels: Record<Dimension, Record<string, string>> = {
    segment: SEGMENT_LABEL,
    region: REGION_LABEL,
    channel: CHANNEL_LABEL,
  };
  const rows = keys.map((key) => {
    // Channel is not a lens axis, so it is filtered by narrowing the fact table
    // instead of by narrowing the lens.
    const agg =
      dimension === "channel"
        ? aggregate(
            { ...db, facts: db.facts.filter((f) => f.channel === key) },
            lens,
            months,
          )
        : aggregate(db, { ...lens, [dimension]: key } as Lens, months);
    return {
      key,
      label: labels[dimension][key] ?? key,
      value: metricValue(metric, agg),
      share: 0,
    };
  });
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  return rows
    .map((r) => ({ ...r, share: total ? r.value / total : 0 }))
    .sort((a, b) => b.value - a.value);
}
