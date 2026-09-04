import type {
  Dashboard,
  DashboardId,
  Department,
  Initiative,
  MetricDef,
  MetricId,
  MetricPoint,
  MetricUnit,
} from "./types";

/** The four operating departments the `byDepartment` metrics break out by. */
const DEPARTMENTS: Department[] = [
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
];

/** Share of a company-wide total attributed to each department, summing to 1. */
const DEPT_WEIGHT: Record<Department, number> = {
  manufacturing: 0.4,
  distribution: 0.3,
  "field-services": 0.2,
  corporate: 0.1,
};

/**
 * All 14 `MetricId`s. Only `opex` and `headcountCost` carry per-department
 * series (§ spec) — everything else is company-wide only. `thresholdPct` for
 * `revenue`, `opex`, and `dsoDays` is fixed by the seeded-breach contract
 * below; the rest are plausible peer values.
 */
export function seedMetricDefs(): MetricDef[] {
  return [
    {
      id: "revenue",
      label: "Revenue",
      unit: "usd",
      audience: "both",
      thresholdPct: 0.05,
      byDepartment: false,
    },
    {
      id: "growthQoQ",
      label: "Growth (QoQ)",
      unit: "pct",
      audience: "ceo",
      thresholdPct: 0.1,
      byDepartment: false,
    },
    {
      id: "growthYoY",
      label: "Growth (YoY)",
      unit: "pct",
      audience: "ceo",
      thresholdPct: 0.08,
      byDepartment: false,
    },
    {
      id: "operatingMargin",
      label: "Operating Margin",
      unit: "pct",
      audience: "cfo",
      thresholdPct: 0.04,
      byDepartment: false,
    },
    {
      id: "ebitda",
      label: "EBITDA",
      unit: "usd",
      audience: "both",
      thresholdPct: 0.06,
      byDepartment: false,
    },
    {
      id: "cash",
      label: "Cash",
      unit: "usd",
      audience: "cfo",
      thresholdPct: 0.06,
      byDepartment: false,
    },
    {
      id: "runwayMonths",
      label: "Runway",
      unit: "months",
      audience: "cfo",
      thresholdPct: 0.1,
      byDepartment: false,
    },
    {
      id: "nps",
      label: "NPS",
      unit: "score",
      audience: "ceo",
      thresholdPct: 0.08,
      byDepartment: false,
    },
    {
      id: "burnRate",
      label: "Burn Rate",
      unit: "usd",
      audience: "cfo",
      thresholdPct: 0.06,
      byDepartment: false,
    },
    {
      id: "arAgingDays",
      label: "AR Aging",
      unit: "days",
      audience: "cfo",
      thresholdPct: 0.07,
      byDepartment: false,
    },
    {
      id: "dsoDays",
      label: "DSO",
      unit: "days",
      audience: "cfo",
      thresholdPct: 0.08,
      byDepartment: false,
    },
    {
      id: "opex",
      label: "Opex",
      unit: "usd",
      audience: "cfo",
      thresholdPct: 0.05,
      byDepartment: true,
    },
    {
      id: "headcountCost",
      label: "Headcount Cost",
      unit: "usd",
      audience: "cfo",
      thresholdPct: 0.05,
      byDepartment: true,
    },
    {
      id: "forecastAccuracy",
      label: "Forecast Accuracy",
      unit: "pct",
      audience: "both",
      thresholdPct: 0.05,
      byDepartment: false,
    },
  ];
}

/** Plan-trend seed per metric: a starting value plus a per-month drift. */
const METRIC_TREND: Record<MetricId, { base: number; perMonth: number }> = {
  revenue: { base: 1_000_000, perMonth: 15_000 },
  growthQoQ: { base: 0.03, perMonth: 0.0004 },
  growthYoY: { base: 0.11, perMonth: 0.0008 },
  operatingMargin: { base: 0.17, perMonth: 0.0005 },
  ebitda: { base: 165_000, perMonth: 2_500 },
  cash: { base: 3_800_000, perMonth: 25_000 },
  runwayMonths: { base: 15, perMonth: 0.05 },
  nps: { base: 40, perMonth: 0.15 },
  burnRate: { base: 260_000, perMonth: -800 },
  arAgingDays: { base: 40, perMonth: -0.04 },
  dsoDays: { base: 46, perMonth: -0.05 },
  opex: { base: 720_000, perMonth: 4_000 },
  headcountCost: { base: 510_000, perMonth: 3_500 },
  forecastAccuracy: { base: 0.9, perMonth: 0.0004 },
};

function planValue(metricId: MetricId, monthIndex: number): number {
  const trend = METRIC_TREND[metricId];
  return trend.base + trend.perMonth * monthIndex;
}

function round(value: number, unit: MetricUnit): number {
  switch (unit) {
    case "usd":
      return Math.round(value);
    case "pct":
      return Math.round(value * 10_000) / 10_000;
    case "months":
    case "days":
    case "score":
      return Math.round(value * 10) / 10;
    default:
      return value;
  }
}

/** FNV-1a string hash, used only to seed a deterministic PRNG per point. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — deterministic, seeded from the hash above. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pseudo-random variance in `[-maxAbs, +maxAbs]`, keyed by a string. */
function variancePctFor(key: string, maxAbs: number): number {
  const rand = mulberry32(hashStr(key))();
  return (rand - 0.5) * 2 * maxAbs;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** "YYYY-MM" for a given (year, 0-indexed month). */
function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

/** The latest CLOSED month (the calendar month before the current one). */
function latestClosedMonth(now: Date = new Date()): {
  year: number;
  monthIndex0: number;
} {
  let year = now.getUTCFullYear();
  let monthIndex0 = now.getUTCMonth() - 1;
  if (monthIndex0 < 0) {
    monthIndex0 = 11;
    year -= 1;
  }
  return { year, monthIndex0 };
}

/** `count` consecutive "YYYY-MM" periods, ending at (and including) `latest`. */
function periodsEndingAt(
  latest: { year: number; monthIndex0: number },
  count: number,
): string[] {
  const out: string[] = [];
  let { year, monthIndex0 } = latest;
  for (let i = 0; i < count; i++) {
    out.unshift(monthKey(year, monthIndex0));
    monthIndex0 -= 1;
    if (monthIndex0 < 0) {
      monthIndex0 = 11;
      year -= 1;
    }
  }
  return out;
}

const PERIOD_COUNT = 24;

/**
 * 24 monthly points per metric at `department: "all"`, plus 24 × 4
 * department-level points for `opex` and `headcountCost`. Every variance is a
 * deterministic PRNG draw kept well inside the metric's `thresholdPct` so it
 * never breaches — EXCEPT the four latest-period points overridden at the
 * end of this function, which are the seed's only breaches (three) plus one
 * deliberate non-breaching variance (revenue).
 *
 * For `byDepartment` metrics, `department: "all"` is NEVER an independent
 * draw: it is derived as the sum of the four department rows (plan, actual,
 * and forecast each summed). Both granularities are rendered together in the
 * Metrics Explorer and both are returned by `metricSeries`, so an
 * independent "all" draw would let the numbers contradict each other on
 * stage. `safeMax` below (`thresholdPct * 0.6`) bounds the weighted average
 * of the four department variances well under `thresholdPct`, so summing
 * department rows can never introduce an accidental breach at "all" — see
 * the opex/distribution override below, which is the one case close enough
 * to the margin to need checking explicitly.
 */
export function seedPoints(): MetricPoint[] {
  const defs = seedMetricDefs();
  const periods = periodsEndingAt(latestClosedMonth(), PERIOD_COUNT);
  const latestPeriod = periods[periods.length - 1];
  const points: MetricPoint[] = [];

  defs.forEach((def) => {
    // Keep every generated variance comfortably under threshold so the only
    // breaches in the seed are the ones deliberately overridden below.
    const safeMax = def.thresholdPct * 0.6;
    const forecastMax = def.thresholdPct * 0.3;

    periods.forEach((period, i) => {
      const totalPlan = planValue(def.id, i);

      if (def.byDepartment) {
        // Generate the department rows first, then derive "all" as their
        // sum — never an independent draw — so the two granularities can
        // never disagree.
        let sumPlan = 0;
        let sumActual = 0;
        let sumForecast = 0;
        DEPARTMENTS.forEach((dept) => {
          const deptPlan = totalPlan * DEPT_WEIGHT[dept];
          const deptVariance = variancePctFor(
            `${def.id}|${period}|${dept}`,
            safeMax,
          );
          const deptForecastVariance = variancePctFor(
            `${def.id}|${period}|${dept}|forecast`,
            forecastMax,
          );
          const plan = round(deptPlan, def.unit);
          const actual = round(deptPlan * (1 + deptVariance), def.unit);
          const forecast = round(
            deptPlan * (1 + deptForecastVariance),
            def.unit,
          );
          points.push({
            metricId: def.id,
            period,
            department: dept,
            plan,
            actual,
            forecast,
          });
          sumPlan += plan;
          sumActual += actual;
          sumForecast += forecast;
        });
        points.push({
          metricId: def.id,
          period,
          department: "all",
          plan: sumPlan,
          actual: sumActual,
          forecast: sumForecast,
        });
      } else {
        const allVariance = variancePctFor(
          `${def.id}|${period}|all`,
          safeMax,
        );
        const allForecastVariance = variancePctFor(
          `${def.id}|${period}|all|forecast`,
          forecastMax,
        );
        points.push({
          metricId: def.id,
          period,
          department: "all",
          plan: round(totalPlan, def.unit),
          actual: round(totalPlan * (1 + allVariance), def.unit),
          forecast: round(totalPlan * (1 + allForecastVariance), def.unit),
        });
      }
    });
  });

  const unitOf = (metricId: MetricId): MetricUnit =>
    defs.find((d) => d.id === metricId)!.unit;

  /** Force `actual = plan * (1 + variancePct)` on one specific seeded point. */
  function overrideVariance(
    metricId: MetricId,
    period: string,
    department: Department | "all",
    variancePct: number,
  ): void {
    const point = points.find(
      (p) =>
        p.metricId === metricId &&
        p.period === period &&
        p.department === department,
    );
    if (!point)
      throw new Error(
        `seed: expected point ${metricId}/${period}/${department} to exist`,
      );
    point.actual = round(point.plan * (1 + variancePct), unitOf(metricId));
  }

  /**
   * Re-derive a `byDepartment` metric's "all" row at `period` as the sum of
   * its four department rows. Call this after any override mutates a
   * department-level point, so `department: "all"` never goes stale and
   * drifts back out of agreement with the rows it is supposed to aggregate.
   */
  function recomputeAllFromDepartments(metricId: MetricId, period: string): void {
    const deptPoints = DEPARTMENTS.map((dept) => {
      const point = points.find(
        (p) =>
          p.metricId === metricId &&
          p.period === period &&
          p.department === dept,
      );
      if (!point)
        throw new Error(
          `seed: expected point ${metricId}/${period}/${dept} to exist`,
        );
      return point;
    });
    const allPoint = points.find(
      (p) =>
        p.metricId === metricId && p.period === period && p.department === "all",
    );
    if (!allPoint)
      throw new Error(`seed: expected point ${metricId}/${period}/all to exist`);
    allPoint.plan = deptPoints.reduce((sum, p) => sum + p.plan, 0);
    allPoint.actual = deptPoints.reduce((sum, p) => sum + p.actual, 0);
    allPoint.forecast = deptPoints.reduce((sum, p) => sum + p.forecast, 0);
  }

  // ── THE SEED'S THREE UNEXPLAINED BREACHES, ALL IN THE LATEST PERIOD ──────
  //
  // The count is THREE, not two, and the third one is what keeps the demo's
  // beats in the order they are scripted in. The breach budget is spent on
  // one breach per GATE the arc has to hit:
  //
  //  · `opex`/distribution — beat 3a's and beat 3d's narrative subject (the
  //    generated budget memo is about this exact overrun). Filing it CONSUMES
  //    this breach.
  //  · `burnRate`/all — beat 6's TEACH gate. The CFO dashboard's blocks
  //    reference `opex` AND `burnRate` (`seedDashboards` below), so with opex
  //    alone the seed had a fatal beat-ORDER dependency: a presenter who ran
  //    3a or 3d before 6 filed the only breach the CFO pack could refuse on,
  //    the publish sailed through, and beat 6's whole teach arc silently
  //    stopped existing. `burnRate` is never a narrative subject in any
  //    earlier beat, so the CFO refusal survives every pill run before it.
  //  · `dsoDays`/all — beat 6's unaided REPLAY gate. The CEO dashboard
  //    carries an `exceptionList`, which makes its publish gate consider
  //    EVERY metric (`referencedMetrics` in `store.ts`), and `dsoDays` is on
  //    no dashboard block of its own — so the CEO pack still refuses after
  //    both of the above are explained, which is what the agent replays the
  //    just-taught procedure against.
  //
  // Three metrics also keep `store.test.ts`'s seed invariant honest: two
  // DIFFERENT metrics minimum, so the taught case and the replay can never
  // collapse onto the same one.
  overrideVariance("opex", latestPeriod, "distribution", 0.09); // threshold 0.05 -> breach
  // `opex`/"all" is derived, so the distribution override above must flow
  // into it. Re-summing here keeps `all.actual === sum(dept.actual)` true
  // after the override — and it stays a NON-breach: distribution is 30% of
  // opex, so even at +9% the recomputed "all" variance tops out well under
  // opex's 5% threshold (worst case ~4.8%, given every other department is
  // held under `safeMax`). If the department weights or `safeMax` ever
  // change, `store.test.ts`'s breach-set invariant will catch a regression.
  recomputeAllFromDepartments("opex", latestPeriod);
  overrideVariance("burnRate", latestPeriod, "all", 0.1); // threshold 0.06, company-wide -> breach
  overrideVariance("dsoDays", latestPeriod, "all", 0.12); // threshold 0.08, company-wide -> breach
  // A deliberate non-breach: variance without tripping the gate.
  overrideVariance("revenue", latestPeriod, "all", -0.02); // threshold 0.05 -> not a breach

  return points;
}

/** 5 initiatives on the CEO's initiative table — exactly one red, one yellow. */
export function seedInitiatives(): Initiative[] {
  return [
    {
      id: "init-distribution-automation",
      name: "Distribution center automation",
      owner: "Priya Nair",
      status: "red",
      note: "Integrator delay pushed go-live past quarter close; opex overrun tracks to this.",
    },
    {
      id: "init-sales-comp-redesign",
      name: "Sales comp plan redesign",
      owner: "Marcus Webb",
      status: "yellow",
      note: "Legal review of the new plan is running a week behind.",
    },
    {
      id: "init-erp-migration",
      name: "ERP migration, phase 2",
      owner: "Dana Kim",
      status: "green",
      note: "On track for next month's cutover window.",
    },
    {
      id: "init-pricing-optimization",
      name: "Pricing optimization rollout",
      owner: "Elena Torres",
      status: "green",
      note: "Rolled out to 3 of 4 regions with no adverse churn signal.",
    },
    {
      id: "init-collections-playbook",
      name: "Collections playbook refresh",
      owner: "Sam Okafor",
      status: "green",
      note: "New dunning cadence live; early signs of faster collections.",
    },
  ];
}

/** Fixed anchor for seeded `addedAt` stamps, so the seed is fully deterministic. */
const SEED_ADDED_AT = "2024-01-01T00:00:00.000Z";

/**
 * CEO and CFO starter dashboards. CEO gets `revenue` (metricTile) plus an
 * `initiativeTable` and `exceptionList` (3 blocks, ≥2). CFO gets `opex`
 * (varianceBar) plus `burnRate` (trendLine) (2 blocks, ≥2) — those two blocks
 * are what put the seeded `opex` and `burnRate` breaches inside the CFO
 * pack's gate, so the seeded publish attempt on `cfo` returns 422
 * UNEXPLAINED_VARIANCE. `burnRate` is the one that keeps returning it after
 * beats 3a/3d have explained `opex` — see `seedPoints`' breach block for why
 * the seed spends a breach on a metric no earlier beat touches.
 */
export function seedDashboards(): Record<DashboardId, Dashboard> {
  return {
    ceo: {
      id: "ceo",
      title: "CEO Dashboard",
      blocks: [
        {
          id: "seed-ceo-revenue",
          spec: {
            kind: "metricTile",
            title: "Revenue vs Plan",
            metricId: "revenue",
            department: "all",
            compare: "plan",
          },
          addedAt: SEED_ADDED_AT,
        },
        {
          id: "seed-ceo-initiatives",
          spec: { kind: "initiativeTable", title: "Key Initiatives" },
          addedAt: SEED_ADDED_AT,
        },
        {
          id: "seed-ceo-exceptions",
          spec: { kind: "exceptionList", title: "Open Exceptions" },
          addedAt: SEED_ADDED_AT,
        },
      ],
    },
    cfo: {
      id: "cfo",
      title: "CFO Dashboard",
      blocks: [
        {
          id: "seed-cfo-opex-variance",
          spec: {
            kind: "varianceBar",
            title: "Opex Variance by Department",
            metricId: "opex",
          },
          addedAt: SEED_ADDED_AT,
        },
        {
          id: "seed-cfo-burn-trend",
          spec: {
            kind: "trendLine",
            title: "Burn Rate Trend",
            metricId: "burnRate",
            department: "all",
            months: 12,
          },
          addedAt: SEED_ADDED_AT,
        },
      ],
    },
  };
}
