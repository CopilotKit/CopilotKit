import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";

beforeEach(() => store.reset());

describe("seed invariants", () => {
  it("seeds at least TWO breaching, unexplained exceptions so the taught case and the replay differ", () => {
    const breaches = store.exceptions().filter((e) => !e.explained);
    expect(breaches.length).toBeGreaterThanOrEqual(2);
    // Two DIFFERENT metrics — teaching on one and replaying on the same one proves nothing.
    expect(
      new Set(breaches.map((b) => b.metricId)).size,
    ).toBeGreaterThanOrEqual(2);
  });
  it("seeds starter blocks on both dashboards so neither page opens blank", () => {
    const snap = store.snapshot();
    expect(snap.dashboards.ceo.blocks.length).toBeGreaterThanOrEqual(2);
    expect(snap.dashboards.cfo.blocks.length).toBeGreaterThanOrEqual(2);
  });
  it("has 24 monthly periods for every company-wide metric", () => {
    expect(store.metricSeries({ metricId: "revenue" })).toHaveLength(24);
  });
});

describe("variance and the publish gate", () => {
  it("derives variance, never stores it", () => {
    const p = store.metricSeries({ metricId: "revenue", months: 1 })[0];
    expect(store.variancePct(p)).toBeCloseTo((p.actual - p.plan) / p.plan);
  });
  it("refuses to publish while a breach is unexplained (422 UNEXPLAINED_VARIANCE)", () => {
    const r = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(r).toMatchObject({
      ok: false,
      status: 422,
      code: "UNEXPLAINED_VARIANCE",
    });
    if (!r.ok && r.code === "UNEXPLAINED_VARIANCE")
      expect(r.breaches.length).toBeGreaterThan(0);
  });
  it("publishes once every breach has a narrative filed for its (metricId, period)", () => {
    for (const b of store.exceptions().filter((e) => !e.explained)) {
      store.fileNarrative({
        metricId: b.metricId,
        period: b.period,
        code: "VAR-TIMING",
        body: "Shipment timing shift.",
        source: "typed",
      });
    }
    expect(store.publishPack("cfo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: true,
    });
  });
  it("refuses a wrong countersign PIN before checking variance (403 BAD_COUNTERSIGN)", () => {
    expect(store.publishPack("cfo", "0000")).toMatchObject({
      ok: false,
      status: 403,
      code: "BAD_COUNTERSIGN",
    });
  });
});

describe("dashboard blocks", () => {
  it("adds a draft block to a dashboard idempotently", () => {
    const draft = store.createDraftBlock({
      kind: "metricTile",
      title: "Revenue vs plan",
      metricId: "revenue",
      compare: "plan",
    });
    const before = store.snapshot().dashboards.ceo.blocks.length;
    store.addBlockToDashboard("ceo", draft.id);
    store.addBlockToDashboard("ceo", draft.id); // second add is a no-op
    expect(store.snapshot().dashboards.ceo.blocks.length).toBe(before + 1);
  });
  it("moves and removes blocks", () => {
    const ids = () => store.snapshot().dashboards.ceo.blocks.map((b) => b.id);
    const [first, second] = ids();
    store.moveBlock("ceo", second, "up");
    expect(ids()[0]).toBe(second);
    store.removeBlock("ceo", first);
    expect(ids()).not.toContain(first);
  });
});
