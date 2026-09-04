import { describe, expect, it } from "vitest";
import { filterMetricRows, parseTopLever } from "./metric-rows";
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
      point("dsoDays", "distribution", 100, 50), // |-0.50|
      point("revenue", "distribution", 100, 130), // |0.30|
      point("arAgingDays", "distribution", 100, 120), // |0.20|
      point("headcountCost", "distribution", 100, 90), // |-0.10|
      point("opex", "distribution", 100, 109), // |0.09|
      point("burnRate", "distribution", 100, 106), // |0.06|
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
    // Descending by |variance|, not merely "some order".
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1].variancePct)).toBeGreaterThanOrEqual(
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
});
