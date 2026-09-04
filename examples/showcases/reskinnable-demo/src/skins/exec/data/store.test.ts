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
  /**
   * THE BEAT-ORDER SEAM GUARD. Beats 3a and 3d file a narrative for the
   * `opex`/distribution overrun; beat 6 then needs the CFO publish to STILL
   * be refused (teach) and the CEO publish to STILL be refused after that
   * (unaided replay). With only the opex breach seeded, running 3a or 3d
   * before 6 cleared the CFO gate and beat 6's whole teach arc silently
   * stopped existing — a demo failure that compiles, passes and looks fine
   * until stage. The seed's third breach (`burnRate`, see `seed.ts`) is what
   * makes the order irrelevant, and this test is what stops anyone dropping
   * it again.
   */
  it("keeps beat 6's gates armed no matter which order the beats run in", () => {
    const opex = store
      .exceptions()
      .find((e) => e.metricId === "opex" && !e.explained);
    expect(
      opex,
      "seed no longer carries an unexplained opex breach",
    ).toBeDefined();

    // Beats 3a/3d: the opex narrative is filed.
    store.fileNarrative({
      metricId: opex!.metricId,
      period: opex!.period,
      code: "VAR-TIMING",
      body: "Shipment timing shift into the next month.",
      source: "typed",
    });

    // Beat 6's TEACH gate: the CFO pack references opex AND burnRate, so it
    // still refuses — on burnRate, which no earlier beat explains.
    const cfo = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(cfo).toMatchObject({
      ok: false,
      status: 422,
      code: "UNEXPLAINED_VARIANCE",
    });
    if (!cfo.ok && cfo.code === "UNEXPLAINED_VARIANCE") {
      expect(cfo.breaches.map((b) => b.metricId)).toContain("burnRate");
    }

    // Beat 6's teach files burnRate's narrative — and the CEO pack, whose
    // `exceptionList` block makes its gate consider every metric, STILL
    // refuses on dsoDays. That refusal is the unaided replay.
    const burn = store
      .exceptions()
      .find((e) => e.metricId === "burnRate" && !e.explained);
    expect(
      burn,
      "seed no longer carries an unexplained burnRate breach",
    ).toBeDefined();
    store.fileNarrative({
      metricId: burn!.metricId,
      period: burn!.period,
      code: "VAR-PLAN",
      body: "Plan was set before the hiring freeze landed.",
      source: "typed",
    });

    const ceo = store.publishPack("ceo", store.COUNTERSIGN_PIN);
    expect(ceo).toMatchObject({
      ok: false,
      status: 422,
      code: "UNEXPLAINED_VARIANCE",
    });
    if (!ceo.ok && ceo.code === "UNEXPLAINED_VARIANCE") {
      expect(ceo.breaches.map((b) => b.metricId)).toContain("dsoDays");
    }
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
