import { describe, it, expect } from "vitest";
import { buildReportOps, SURFACE_ID } from "./build-report-ops";
import { CATALOG_ID } from "./catalog/definitions";

function componentsOf(ops: ReturnType<typeof buildReportOps>) {
  const uc = ops.find((op) => "updateComponents" in op) as any;
  return uc.updateComponents.components as Array<Record<string, any>>;
}

describe("buildReportOps", () => {
  it("emits createSurface (our catalog) + updateComponents with a root Stack", () => {
    const ops = buildReportOps({
      title: "Spend Report",
      kpis: ["totalSpend"],
      charts: ["spendingTrend"],
    });
    const cs = ops.find((op) => "createSurface" in op) as any;
    expect(cs.createSurface).toEqual({ surfaceId: SURFACE_ID, catalogId: CATALOG_ID });
    expect(cs.version).toBe("v0.9");

    const comps = componentsOf(ops);
    const root = comps.find((c) => c.id === "root");
    expect(root).toMatchObject({ component: "Stack" });
    // root references only defined component ids
    const ids = new Set(comps.map((c) => c.id));
    for (const childId of root!.children as string[]) expect(ids.has(childId)).toBe(true);
  });

  it("maps each KPI metric to a StatCard with a human label", () => {
    const comps = componentsOf(
      buildReportOps({ title: "R", kpis: ["overLimitCount", "policyCount"], charts: [] }),
    );
    const overLimit = comps.find((c) => c.id === "kpi-overLimitCount");
    expect(overLimit).toMatchObject({ component: "StatCard", metric: "overLimitCount", label: "Over limit" });
    expect(comps.some((c) => c.component === "Grid")).toBe(true);
  });

  it("maps each chart kind to a Chart node and includes the pending table when asked", () => {
    const comps = componentsOf(
      buildReportOps({ title: "R", kpis: [], charts: ["budgetUsage"], pendingTable: true }),
    );
    expect(comps.find((c) => c.id === "chart-budgetUsage")).toMatchObject({
      component: "Chart",
      kind: "budgetUsage",
    });
    expect(comps.find((c) => c.component === "PendingTable")).toBeDefined();
  });

  it("omits summary when not provided and includes it (muted) when provided", () => {
    const without = componentsOf(buildReportOps({ title: "R", kpis: [], charts: [] }));
    expect(without.some((c) => c.id === "summary")).toBe(false);

    const withSummary = componentsOf(
      buildReportOps({ title: "R", kpis: [], charts: [], summary: "Spend overview" }),
    );
    expect(withSummary.find((c) => c.id === "summary")).toMatchObject({
      component: "Text",
      text: "Spend overview",
      tone: "muted",
    });
  });
});
