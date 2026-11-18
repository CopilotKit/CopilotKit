import { describe, it, expect } from "vitest";
import { buildOpsReportOps } from "./ops-report";

type Component = { id: string; component: string } & Record<string, unknown>;
type A2UIOp = Record<string, unknown>;
type ComponentsOp = {
  updateComponents: { surfaceId: string; components: Component[] };
};

function componentsOf(ops: A2UIOp[]): Component[] {
  const uc = ops.find((op) => "updateComponents" in op) as
    | ComponentsOp
    | undefined;
  return uc?.updateComponents.components ?? [];
}

describe("buildOpsReportOps de-duplication", () => {
  it("collapses a duplicated KPI selection into exactly one unique component", () => {
    const comps = componentsOf(
      buildOpsReportOps({
        title: "Ops overview",
        kpis: ["openRuns", "openRuns"],
        charts: [],
      }),
    );

    const kpiCards = comps.filter((c) => c.component === "KpiCard");
    expect(kpiCards).toHaveLength(1);
    expect(kpiCards[0]?.id).toBe("kpi-openRuns");

    // Ids across the whole component set must be unique (they are used as
    // React key={id} and as a2ui component-map keys).
    const ids = comps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    // The grid must reference the single card once, and its column count must
    // match the de-duplicated child count.
    const grid = comps.find((c) => c.id === "kpi-grid");
    expect(grid?.children).toEqual(["kpi-openRuns"]);
    expect(grid?.columns).toBe(1);
  });

  it("collapses a duplicated chart selection into exactly one unique component", () => {
    const comps = componentsOf(
      buildOpsReportOps({
        title: "Ops overview",
        kpis: [],
        charts: ["statusBreakdown", "statusBreakdown"],
      }),
    );

    const charts = comps.filter((c) => c.component === "RunChart");
    expect(charts).toHaveLength(1);
    expect(charts[0]?.id).toBe("chart-statusBreakdown");

    const ids = comps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    const grid = comps.find((c) => c.id === "chart-grid");
    expect(grid?.children).toEqual(["chart-statusBreakdown"]);
    expect(grid?.columns).toBe(1);
  });

  it("preserves the order of the distinct selections after de-duplication", () => {
    const comps = componentsOf(
      buildOpsReportOps({
        title: "Ops overview",
        // Interleaved duplicates: distinct order is blockedRuns, openRuns.
        kpis: ["blockedRuns", "openRuns", "blockedRuns", "openRuns"],
        charts: [
          "bottleneckByStep",
          "throughputByPlaybook",
          "bottleneckByStep",
        ],
      }),
    );

    const kpiGrid = comps.find((c) => c.id === "kpi-grid");
    expect(kpiGrid?.children).toEqual(["kpi-blockedRuns", "kpi-openRuns"]);

    const chartGrid = comps.find((c) => c.id === "chart-grid");
    expect(chartGrid?.children).toEqual([
      "chart-bottleneckByStep",
      "chart-throughputByPlaybook",
    ]);

    const ids = comps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
