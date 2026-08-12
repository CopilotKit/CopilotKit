import { describe, it, expect } from "vitest";
import {
  buildBriefOps,
  extractSurfaceId,
  SURFACE_ID,
  renderBriefParams,
} from "./build-brief-ops";
import type { A2UIOp } from "./build-brief-ops";

type Comp = Record<string, unknown>;

function componentsOf(ops: A2UIOp[]): Comp[] {
  const uc = ops.find((op) => "updateComponents" in op) as
    | { updateComponents: { components: Comp[] } }
    | undefined;
  return uc?.updateComponents.components ?? [];
}

function byId(comps: Comp[], id: string): Comp | undefined {
  return comps.find((c) => c.id === id);
}

describe("buildBriefOps", () => {
  it("emits createSurface then updateComponents with a root Stack", () => {
    const ops = buildBriefOps({
      title: "Weekly Exceptions",
      kpis: [],
      charts: [],
    });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: SURFACE_ID },
    });
    const components = componentsOf(ops);
    expect(components[0]).toMatchObject({ id: "root", component: "Stack" });
    expect(byId(components, "heading")).toMatchObject({
      component: "Heading",
      text: "Weekly Exceptions",
    });
  });

  it("expands each selected KPI into a StatCard inside a grid", () => {
    const ops = buildBriefOps({
      title: "T",
      kpis: ["onTimeRate", "exposureUsd"],
      charts: [],
    });
    const components = componentsOf(ops);
    expect(byId(components, "kpi-onTimeRate")).toMatchObject({
      component: "StatCard",
      metric: "onTimeRate",
      label: "On-time rate",
    });
    expect(byId(components, "kpi-grid")).toMatchObject({
      component: "Grid",
      columns: 2,
      children: ["kpi-onTimeRate", "kpi-exposureUsd"],
    });
  });

  it("carries NO data in the ops — only selections and labels", () => {
    const ops = buildBriefOps({
      title: "T",
      kpis: ["exposureUsd"],
      charts: ["delayTrend"],
      exceptions: "delayed",
    });
    const json = JSON.stringify(ops);
    expect(json).not.toMatch(/\d{3,}/); // no raw figures leaked into the ops
  });

  it("includes the exception table and the tradeoff table only when requested", () => {
    const bare = componentsOf(
      buildBriefOps({ title: "T", kpis: [], charts: [] }),
    );
    expect(bare.find((c) => c.component === "ExceptionTable")).toBeUndefined();

    const full = componentsOf(
      buildBriefOps({
        title: "T",
        kpis: [],
        charts: [],
        exceptions: "at_risk",
        tradeoffShipmentId: "shp-4821",
      }),
    );
    expect(full.find((c) => c.component === "ExceptionTable")).toMatchObject({
      status: "at_risk",
    });
    expect(full.find((c) => c.component === "TradeoffTable")).toMatchObject({
      shipmentId: "shp-4821",
    });
  });

  it("adds an optional muted summary caption", () => {
    const components = componentsOf(
      buildBriefOps({
        title: "T",
        kpis: [],
        charts: [],
        summary: "Trans-Pacific focus",
      }),
    );
    expect(byId(components, "summary")).toMatchObject({
      component: "Text",
      tone: "muted",
    });
  });

  it("extracts the surface id from any op kind", () => {
    expect(
      extractSurfaceId(buildBriefOps({ title: "T", kpis: [], charts: [] })),
    ).toBe(SURFACE_ID);
    expect(extractSurfaceId([])).toBeNull();
  });

  it("rejects an uncatalogued metric at the schema boundary", () => {
    expect(
      renderBriefParams.safeParse({ title: "T", kpis: ["madeUp"], charts: [] })
        .success,
    ).toBe(false);
  });
});
