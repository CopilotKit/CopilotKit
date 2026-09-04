import { describe, expect, it } from "vitest";
import {
  filterMetricRows,
  normalizePeriodLever,
  parseTopLever,
} from "./metric-rows";
import { nextLeverSearchParams } from "./metrics-explorer";
import type {
  Dashboard,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
} from "../data/types";

/**
 * A synthetic snapshot, not the app's live seed. The plan's test case turns
 * on top-5 among MORE than five breaching Distribution metrics, and the real
 * seed (`data/seed.ts`) deliberately keeps only one department-level breach
 * (`opex`/distribution); its whole breach budget is three unexplained
 * exceptions, one per gate the demo's teaching narrative has to hit (see that
 * file's breach block). Depending on that count here would
 * make this test fail the moment the seed's breach budget changes for
 * reasons that have nothing to do with `filterMetricRows`.
 */
function def(id: MetricId, thresholdPct: number): MetricDef {
  return {
    id,
    label: `Label ${id}`,
    unit: "usd",
    audience: "both",
    thresholdPct,
    byDepartment: true,
  };
}

function point(
  metricId: MetricId,
  department: MetricPoint["department"],
  plan: number,
  actual: number,
  period = "2024-06",
): MetricPoint {
  return { metricId, period, department, plan, actual, forecast: plan };
}

const EMPTY_DASHBOARD = (id: "ceo" | "cfo"): Dashboard => ({
  id,
  title: id,
  blocks: [],
});

function buildSnapshot(): LedgerSnapshot {
  return {
    metricDefs: [
      def("dsoDays", 0.05),
      def("revenue", 0.05),
      def("arAgingDays", 0.05),
      def("headcountCost", 0.05),
      def("opex", 0.05),
      def("burnRate", 0.05),
      def("cash", 0.05),
      def("ebitda", 0.05),
    ],
    points: [
      // Distribution — six breaching rows, |variance| deliberately distinct
      // so descending order is unambiguous: dso .50, revenue .30, arAging
      // .20, headcountCost .10, opex .09, burnRate .06.
      //
      // INSERTION ORDER IS DELIBERATELY NOT THE SORTED ORDER. Listed
      // descending, the top-N test passes whether or not `filterMetricRows`
      // sorts at all — `slice(0, 5)` over an already-descending array returns
      // the expected five in the expected order, so deleting the `.sort()`
      // keeps the suite green. Shuffled, the sort is the only thing that can
      // produce the expected order, and it is also what decides WHICH five
      // survive the slice (insertion order would keep burnRate .06 and drop
      // arAgingDays .20).
      point("opex", "distribution", 100, 109), // |0.09|
      point("dsoDays", "distribution", 100, 50), // |-0.50|
      point("headcountCost", "distribution", 100, 90), // |-0.10|
      point("burnRate", "distribution", 100, 106), // |0.06|
      point("revenue", "distribution", 100, 130), // |0.30|
      point("arAgingDays", "distribution", 100, 120), // |0.20|
      // Distribution — two NON-breaching rows, to prove `threshold=1` excludes them.
      point("cash", "distribution", 100, 101), // |0.01|
      point("ebitda", "distribution", 100, 100), // |0|
      // Other scopes, to prove `department=distribution` excludes them even
      // though both breach.
      point("revenue", "manufacturing", 100, 200), // |1.0|
      point("dsoDays", "all", 100, 40), // |-0.60|
    ],
    initiatives: [],
    narratives: [],
    dashboards: { ceo: EMPTY_DASHBOARD("ceo"), cfo: EMPTY_DASHBOARD("cfo") },
    packs: [],
    exceptions: [],
  };
}

describe("parseTopLever", () => {
  it("accepts only positive integers", () => {
    expect(parseTopLever("5")).toBe(5);
    expect(parseTopLever("1")).toBe(1);
  });
  it("drops a fractional value rather than rounding it", () => {
    expect(parseTopLever("2.5")).toBeNull();
  });
  it("drops a negative or zero value rather than clamping it", () => {
    expect(parseTopLever("-1")).toBeNull();
    expect(parseTopLever("0")).toBeNull();
  });
  it("drops junk and absent values", () => {
    expect(parseTopLever("abc")).toBeNull();
    expect(parseTopLever(null)).toBeNull();
    expect(parseTopLever(undefined)).toBeNull();
  });
});

describe("filterMetricRows", () => {
  it("returns every row when no lever is set", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(new URLSearchParams(), snapshot);
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("plan's case: department + threshold + top-5, ordered by descending |variance|", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=5&threshold=1"),
      snapshot,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.department === "distribution")).toBe(true);
    expect(rows.every((r) => r.breaching)).toBe(true);
    expect(rows.map((r) => r.metricId)).toEqual([
      "dsoDays",
      "revenue",
      "arAgingDays",
      "headcountCost",
      "opex",
    ]);

    // The ORDERING QUANTITY itself, not just the ids: every |variance| in the
    // fixture is distinct, so this pins one exact descending sequence. A
    // stable-but-unsorted result cannot produce it.
    const magnitudes = rows.map((r) =>
      Number(Math.abs(r.variancePct).toFixed(4)),
    );
    expect(magnitudes).toEqual([0.5, 0.3, 0.2, 0.1, 0.09]);
    // Distinct, so "descending" below is STRICT — a tie would let an
    // unsorted order slip past a >= comparison.
    expect(new Set(magnitudes).size).toBe(magnitudes.length);
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1].variancePct)).toBeGreaterThan(
        Math.abs(rows[i].variancePct),
      );
    }
  });

  it("ignores a fractional top, narrowing nothing beyond department + threshold", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=2.5&threshold=1"),
      snapshot,
    );
    // All six breaching Distribution rows, unsliced.
    expect(rows).toHaveLength(6);
  });

  it("ignores a negative top, narrowing nothing beyond department + threshold", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=-1&threshold=1"),
      snapshot,
    );
    expect(rows).toHaveLength(6);
  });

  it("threshold absent admits both breaching and non-breaching rows", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution"),
      snapshot,
    );
    expect(rows).toHaveLength(8);
  });

  it("an unrecognised department narrows nothing", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=not-a-department"),
      snapshot,
    );
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("period narrows to the exact period only", () => {
    const snapshot = buildSnapshot();
    snapshot.points.push(point("revenue", "corporate", 100, 105, "2024-07"));
    const rows = filterMetricRows(
      new URLSearchParams("period=2024-07"),
      snapshot,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].period).toBe("2024-07");
  });

  /**
   * `?period=` (or `?period=%20`) must narrow NOTHING, the same rule
   * `department`/`top` already honour for a value they cannot use — not
   * "narrow to rows whose period is the empty string", which is every row at
   * once, silently. This failed before `normalizePeriodLever` (`./metric-rows`)
   * existed: `searchParams.get("period")` returned `""`, which is `!== null`,
   * so the `period !== null && point.period !== period` guard excluded every
   * point in the snapshot.
   */
  it("an empty period narrows nothing, the same as an absent one", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(new URLSearchParams("period="), snapshot);
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("a whitespace-only period narrows nothing", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("period=%20%20"),
      snapshot,
    );
    expect(rows).toHaveLength(snapshot.points.length);
  });
});

describe("normalizePeriodLever", () => {
  it("passes a real period straight through", () => {
    expect(normalizePeriodLever("2024-06")).toBe("2024-06");
  });
  it("treats an empty or whitespace-only value as absent", () => {
    expect(normalizePeriodLever("")).toBeNull();
    expect(normalizePeriodLever("   ")).toBeNull();
  });
  it("treats null and undefined as absent", () => {
    expect(normalizePeriodLever(null)).toBeNull();
    expect(normalizePeriodLever(undefined)).toBeNull();
  });
});

describe("nextLeverSearchParams", () => {
  const CURRENT = {
    period: null as string | null,
    department: null as "manufacturing" | "all" | null,
    threshold: false,
    top: null as number | null,
  };

  it("preserves a param outside the four levers untouched", () => {
    const base = new URLSearchParams("foo=bar&department=manufacturing");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: "manufacturing" },
      { threshold: true },
    );
    expect(next.get("foo")).toBe("bar");
    expect(next.get("threshold")).toBe("1");
    expect(next.get("department")).toBe("manufacturing");
  });

  it("restates the VALIDATED department, dropping an unrecognised raw value, on a push that doesn't touch department", () => {
    // The raw query string carries an unrecognised department (as if the page
    // were reached with `?department=bogus`); `current.department` is what
    // the page itself already validated to `null` for that same value.
    const base = new URLSearchParams("department=bogus");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: null },
      { threshold: true },
    );
    expect(next.get("department")).toBeNull();
    expect(next.get("threshold")).toBe("1");
  });

  it("still allows an explicit department override to set a new value", () => {
    const base = new URLSearchParams("department=bogus");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: null },
      { department: "manufacturing" },
    );
    expect(next.get("department")).toBe("manufacturing");
  });

  it("clears a lever when the override is explicitly null", () => {
    const base = new URLSearchParams("period=2024-06&top=10");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, period: "2024-06", top: 10 },
      { period: null },
    );
    expect(next.get("period")).toBeNull();
    // `top` was not touched by this override, so it restates its current
    // (parsed) value rather than vanishing alongside `period`.
    expect(next.get("top")).toBe("10");
  });

  it("leaves an untouched lever exactly as it currently is when no key names it", () => {
    const base = new URLSearchParams("top=25");
    const next = nextLeverSearchParams(base, { ...CURRENT, top: 25 }, {});
    expect(next.get("top")).toBe("25");
  });
});
