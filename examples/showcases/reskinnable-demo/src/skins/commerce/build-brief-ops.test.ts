import { describe, it, expect } from "vitest";
import {
  buildBriefOps,
  extractSurfaceId,
  BRIEF_LISTS,
  BRIEF_METRICS,
  SURFACE_ID,
  renderBriefParams,
} from "./build-brief-ops";
import type { A2UIOp } from "./build-brief-ops";

type Component = { id: string; component: string } & Record<string, unknown>;
type ComponentsOp = {
  updateComponents: { surfaceId: string; components: Component[] };
};

function componentsOf(ops: A2UIOp[]): Component[] {
  const uc = ops.find((op) => "updateComponents" in op) as
    | ComponentsOp
    | undefined;
  return uc?.updateComponents.components ?? [];
}

function byId(comps: Component[], id: string): Component | undefined {
  return comps.find((c) => c.id === id);
}

/**
 * a2ui's per-surface componentsModel is a MAP keyed by component id, and the
 * layout renderers use the id as `key={id}`. So id uniqueness across the whole
 * emitted tree is a contract, not a nicety: a collision silently overwrites a
 * card and trips a React duplicate-key warning.
 */
function expectUniqueIds(comps: Component[]): void {
  const ids = comps.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe("buildBriefOps", () => {
  it("emits createSurface then updateComponents with a root Stack", () => {
    const ops = buildBriefOps({ title: "Trading Review — Week 40", kpis: [] });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: { surfaceId: SURFACE_ID },
    });
    const comps = componentsOf(ops);
    expect(comps[0]).toMatchObject({ id: "root", component: "Stack" });
    expect(byId(comps, "heading")).toMatchObject({
      component: "Heading",
      text: "Trading Review — Week 40",
    });
    expectUniqueIds(comps);
  });

  it("expands a normal selection unchanged, in order", () => {
    const comps = componentsOf(
      buildBriefOps({
        title: "T",
        kpis: ["valueAtRisk", "medianMargin"],
        categoryBreakdown: true,
        lists: ["belowFloor", "pendingMarkdowns"],
        summary: "Ahead of Monday's review",
      }),
    );

    expect(byId(comps, "kpi-valueAtRisk")).toMatchObject({
      component: "StatCard",
      metric: "valueAtRisk",
      label: "Value at risk",
    });
    expect(byId(comps, "kpi-grid")).toMatchObject({
      component: "Grid",
      columns: 2,
      children: ["kpi-valueAtRisk", "kpi-medianMargin"],
    });
    expect(byId(comps, "category-breakdown")).toMatchObject({
      component: "CategoryBreakdown",
    });
    expect(byId(comps, "summary")).toMatchObject({
      component: "Text",
      tone: "muted",
    });
    expect(
      comps.filter((c) => c.component === "TradingList").map((c) => c.id),
    ).toEqual(["list-belowFloor", "list-pendingMarkdowns"]);
    expect(byId(comps, "root")?.children).toEqual([
      "heading",
      "summary",
      "kpi-grid",
      "category-breakdown",
      "list-belowFloor",
      "list-pendingMarkdowns",
    ]);
    expectUniqueIds(comps);
  });

  it("collapses a duplicated KPI selection into exactly one unique card", () => {
    const comps = componentsOf(
      buildBriefOps({ title: "T", kpis: ["valueAtRisk", "valueAtRisk"] }),
    );

    const cards = comps.filter((c) => c.component === "StatCard");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe("kpi-valueAtRisk");

    // The grid must reference the single card once, and its column count must
    // match the de-duplicated child count.
    expect(byId(comps, "kpi-grid")).toMatchObject({
      columns: 1,
      children: ["kpi-valueAtRisk"],
    });
    expectUniqueIds(comps);
  });

  it("collapses a duplicated list selection into exactly one unique list", () => {
    const comps = componentsOf(
      buildBriefOps({
        title: "T",
        kpis: [],
        lists: ["belowFloor", "belowFloor"],
      }),
    );

    const lists = comps.filter((c) => c.component === "TradingList");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({
      id: "list-belowFloor",
      kind: "belowFloor",
    });
    expect(byId(comps, "root")?.children).toEqual([
      "heading",
      "list-belowFloor",
    ]);
    expectUniqueIds(comps);
  });

  it("preserves the order of the distinct selections after de-duplication", () => {
    const comps = componentsOf(
      buildBriefOps({
        title: "T",
        // Interleaved duplicates: distinct order is belowFloorSkus, valueAtRisk.
        kpis: [
          "belowFloorSkus",
          "valueAtRisk",
          "belowFloorSkus",
          "valueAtRisk",
        ],
        lists: ["pendingMarkdowns", "belowFloor", "pendingMarkdowns"],
      }),
    );

    expect(byId(comps, "kpi-grid")?.children).toEqual([
      "kpi-belowFloorSkus",
      "kpi-valueAtRisk",
    ]);
    expect(
      comps.filter((c) => c.component === "TradingList").map((c) => c.id),
    ).toEqual(["list-pendingMarkdowns", "list-belowFloor"]);
    expectUniqueIds(comps);
  });

  it("keeps ids unique across the whole tree for the maximal selection", () => {
    // Every value-derived id family at once. `pendingMarkdowns` is BOTH a metric
    // and a list kind, so this is the case the "kpi-"/"list-" prefixes exist for.
    const comps = componentsOf(
      buildBriefOps({
        title: "T",
        kpis: [...BRIEF_METRICS],
        categoryBreakdown: true,
        lists: [...BRIEF_LISTS],
        summary: "S",
      }),
    );
    expectUniqueIds(comps);
    expect(comps).toHaveLength(
      // root + heading + summary + kpi cards + kpi-grid + breakdown + lists
      1 + 1 + 1 + BRIEF_METRICS.length + 1 + 1 + BRIEF_LISTS.length,
    );
  });

  it("carries NO data in the ops — only selections and labels", () => {
    // This assertion used to be `not.toMatch(/\d{3,}/)`, whose premise was that a
    // leaked figure runs to three digits. Most do not: a price ("$48.20"), a
    // margin ("42%"), a day count or a small SKU count all pass a three-digit
    // check, so the guard was green on precisely the leaks it was written for.
    //
    // The premise that DOES hold: given a digit-free title and summary, the
    // expansion may introduce no digit of its own — every figure on the canvas is
    // read live by the renderers. So strip the three structural literals that
    // legitimately carry digits, and nothing numeric may remain.
    const ops = buildBriefOps({
      title: "Trading review",
      kpis: [...BRIEF_METRICS],
      categoryBreakdown: true,
      lists: [...BRIEF_LISTS],
      summary: "Ahead of the review",
    });
    const residue = JSON.stringify(ops)
      // The A2UI protocol version, the catalog URL's version segment, and the
      // grid's column count. Nothing else in a data-free expansion has a digit.
      .replaceAll('"version":"v0.9"', "")
      .replace(/"catalogId":"[^"]*"/g, "")
      .replace(/"columns":\d+/g, "");
    expect(
      residue,
      "a digit survived a digit-free spec, so the expansion introduced a figure",
    ).not.toMatch(/\d/);
  });

  it("extracts the surface id from any op kind", () => {
    expect(extractSurfaceId(buildBriefOps({ title: "T", kpis: [] }))).toBe(
      SURFACE_ID,
    );
    expect(extractSurfaceId([])).toBeNull();
  });

  it("rejects an uncatalogued metric or list kind at the schema boundary", () => {
    expect(
      renderBriefParams.safeParse({ title: "T", kpis: ["madeUp"] }).success,
    ).toBe(false);
    expect(
      renderBriefParams.safeParse({ title: "T", kpis: [], lists: ["madeUp"] })
        .success,
    ).toBe(false);
  });
});
