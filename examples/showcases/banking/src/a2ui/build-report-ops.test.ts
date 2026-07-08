import { describe, it, expect } from "vitest";
import { buildReportOps, SURFACE_ID, type A2UIOp } from "./build-report-ops";
import { CATALOG_ID } from "./catalog/definitions";

type Component = Record<string, unknown>;
type CreateOp = {
  version?: string;
  createSurface: { surfaceId: string; catalogId: string };
};
type ComponentsOp = { updateComponents: { components: Component[] } };

function createOp(ops: A2UIOp[]): CreateOp | undefined {
  return ops.find((op) => "createSurface" in op) as CreateOp | undefined;
}

function componentsOf(ops: A2UIOp[]): Component[] {
  const uc = ops.find((op) => "updateComponents" in op) as
    | ComponentsOp
    | undefined;
  return uc?.updateComponents.components ?? [];
}

describe("buildReportOps", () => {
  it("emits createSurface (our catalog) + updateComponents with a root Stack", () => {
    const ops = buildReportOps({
      title: "Spend Report",
      kpis: ["totalSpend"],
      charts: ["spendingTrend"],
    });
    const cs = createOp(ops);
    expect(cs?.createSurface).toEqual({
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
    });
    expect(cs?.version).toBe("v0.9");

    const comps = componentsOf(ops);
    const root = comps.find((c) => c.id === "root");
    expect(root).toMatchObject({ component: "Stack" });
    // root references only defined component ids
    const ids = new Set(comps.map((c) => c.id));
    for (const childId of root!.children as string[])
      expect(ids.has(childId)).toBe(true);
  });

  it("maps each KPI metric to a StatCard with a human label", () => {
    const comps = componentsOf(
      buildReportOps({
        title: "R",
        kpis: ["overLimitCount", "policyCount"],
        charts: [],
      }),
    );
    const overLimit = comps.find((c) => c.id === "kpi-overLimitCount");
    expect(overLimit).toMatchObject({
      component: "StatCard",
      metric: "overLimitCount",
      label: "Over limit",
    });
    expect(comps.some((c) => c.component === "Grid")).toBe(true);
  });

  it("maps each chart kind to a Chart node and includes a filtered Transactions table when asked", () => {
    const comps = componentsOf(
      buildReportOps({
        title: "R",
        kpis: [],
        charts: ["budgetUsage"],
        transactions: "approved",
      }),
    );
    expect(comps.find((c) => c.id === "chart-budgetUsage")).toMatchObject({
      component: "Chart",
      kind: "budgetUsage",
    });
    expect(comps.find((c) => c.component === "Transactions")).toMatchObject({
      component: "Transactions",
      status: "approved",
    });
  });

  it("omits summary when not provided and includes it (muted) when provided", () => {
    const without = componentsOf(
      buildReportOps({ title: "R", kpis: [], charts: [] }),
    );
    expect(without.some((c) => c.id === "summary")).toBe(false);

    const withSummary = componentsOf(
      buildReportOps({
        title: "R",
        kpis: [],
        charts: [],
        summary: "Spend overview",
      }),
    );
    expect(withSummary.find((c) => c.id === "summary")).toMatchObject({
      component: "Text",
      text: "Spend overview",
      tone: "muted",
    });
  });
});
