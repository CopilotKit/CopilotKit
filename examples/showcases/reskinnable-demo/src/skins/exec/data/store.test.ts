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
  /**
   * `byDepartment` metrics (opex, headcountCost) render at BOTH granularities
   * — the "all" row and the four department rows — in the same Metrics
   * Explorer table, and `metricSeries` returns both. If "all" were an
   * independent draw instead of the sum of the department rows, the two
   * granularities could (and did) contradict each other on stage: opex@latest
   * showed "all" actual down 2.25% vs plan while the four departments summed
   * to up 3.47% vs plan — the same metric, same period, opposite story.
   */
  it("derives byDepartment 'all' rows as the sum of the four department rows, every period", () => {
    const snap = store.snapshot();
    const departments = ["manufacturing", "distribution", "field-services", "corporate"] as const;
    const byDeptMetrics = snap.metricDefs.filter((d) => d.byDepartment);
    expect(byDeptMetrics.length).toBeGreaterThan(0);

    for (const def of byDeptMetrics) {
      const rows = snap.points.filter((p) => p.metricId === def.id);
      const periods = [...new Set(rows.map((p) => p.period))];
      expect(periods.length).toBe(24);

      for (const period of periods) {
        const all = rows.find(
          (p) => p.period === period && p.department === "all",
        );
        expect(all, `${def.id}/${period}/all missing`).toBeDefined();

        const depts = departments.map((dept) => {
          const p = rows.find(
            (r) => r.period === period && r.department === dept,
          );
          expect(p, `${def.id}/${period}/${dept} missing`).toBeDefined();
          return p!;
        });

        expect(all!.plan).toBe(depts.reduce((sum, p) => sum + p.plan, 0));
        expect(all!.actual).toBe(depts.reduce((sum, p) => sum + p.actual, 0));
        expect(all!.forecast).toBe(
          depts.reduce((sum, p) => sum + p.forecast, 0),
        );
      }
    }
  });
  /**
   * Hardens the Wave-2 "no other breach" invariant: the seed's breach budget
   * is spent on EXACTLY these three (metricId, department) pairs — see the
   * breach block in `seed.ts` for why the count and the specific metrics
   * matter to the demo's beat order. In particular, deriving `opex`/"all"
   * from the (overridden) department rows must not itself tip `opex`/"all"
   * into an unintended fourth breach.
   */
  it("seeds exactly the breach set {opex/distribution, dsoDays/all, burnRate/all} and no others", () => {
    const breaches = store.exceptions().filter((e) => !e.explained);
    const actual = new Set(
      breaches.map((b) => `${b.metricId}/${b.department}`),
    );
    expect(actual).toEqual(
      new Set(["opex/distribution", "dsoDays/all", "burnRate/all"]),
    );
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

  /**
   * UNPIN RETURNS THE BLOCK TO `drafts`, IT DOES NOT DESTROY IT.
   *
   * The chat transcript's pin control (`AddToDashboard` in
   * `../catalog/renderers.tsx`) and the agent's `pinBlockToDashboard` both
   * stay on screen / callable after an unpin, and both address the block by
   * the same id. Destroying the block on remove made every one of those a
   * guaranteed 404 "no draft block" — the exact revive-a-dead-id confusion
   * the module comment's drafts/dashboard separation exists to prevent.
   */
  it("returns an unpinned block to drafts so it can be re-pinned", () => {
    const draft = store.createDraftBlock({
      kind: "metricTile",
      title: "Revenue vs plan",
      metricId: "revenue",
      compare: "plan",
    });
    store.addBlockToDashboard("ceo", draft.id);
    store.removeBlock("ceo", draft.id);
    expect(
      store.snapshot().dashboards.ceo.blocks.map((b) => b.id),
    ).not.toContain(draft.id);

    // The re-pin is what a still-visible chat pin control does. It must work.
    const repinned = store.addBlockToDashboard("cfo", draft.id);
    expect(repinned.id).toBe(draft.id);
    expect(store.snapshot().dashboards.cfo.blocks.map((b) => b.id)).toContain(
      draft.id,
    );
  });

  /**
   * A seeded block (never a draft) unpins back into drafts too — otherwise
   * "remove" is destructive for exactly the blocks the demo opens with.
   */
  it("returns a SEEDED block to drafts on remove, then re-pins it", () => {
    const seeded = store.snapshot().dashboards.ceo.blocks[0];
    store.removeBlock("ceo", seeded.id);
    const repinned = store.addBlockToDashboard("ceo", seeded.id);
    expect(repinned.id).toBe(seeded.id);
    expect(store.snapshot().dashboards.ceo.blocks.map((b) => b.id)).toContain(
      seeded.id,
    );
  });

  /**
   * Single-home stays: a block lives on at most ONE dashboard. But the refusal
   * has to say WHY. NOT_FOUND told the agent "no draft — render the block
   * again", which is a lie that produces a duplicate block; ALREADY_PINNED
   * names the dashboard it is on, which is actionable (unpin there first).
   */
  it("refuses ALREADY_PINNED — not NOT_FOUND — for a block on the other dashboard", () => {
    const draft = store.createDraftBlock({
      kind: "metricTile",
      title: "Revenue vs plan",
      metricId: "revenue",
      compare: "plan",
    });
    store.addBlockToDashboard("ceo", draft.id);
    expect(() => store.addBlockToDashboard("cfo", draft.id)).toThrow(
      /^ALREADY_PINNED/,
    );
    // The message names the dashboard that holds it AND carries ITS OWN
    // remedy: everything above the store (the POST route, the ledger context,
    // `pinBlockToDashboard`'s failure arm) relays this string verbatim and
    // appends no advice, so "unpin it there first" has to be in here. Getting
    // NOT_FOUND's "render the block first" instead is what made the agent
    // produce a duplicate block.
    expect(() => store.addBlockToDashboard("cfo", draft.id)).toThrow(/ceo/);
    expect(() => store.addBlockToDashboard("cfo", draft.id)).toThrow(/unpin/i);
    // And nothing was multi-homed as a side effect.
    expect(
      store.snapshot().dashboards.cfo.blocks.map((b) => b.id),
    ).not.toContain(draft.id);
  });

  it("still throws NOT_FOUND for a blockId with no draft and no dashboard home", () => {
    expect(() => store.addBlockToDashboard("ceo", "block-nope")).toThrow(
      /^NOT_FOUND/,
    );
    // Names the id and its own remedy, for the same relay-verbatim reason.
    expect(() => store.addBlockToDashboard("ceo", "block-nope")).toThrow(
      /block-nope/,
    );
    expect(() => store.addBlockToDashboard("ceo", "block-nope")).toThrow(
      /render the block first/i,
    );
  });

  /**
   * A failed unpin/move must be distinguishable from a successful one. Silent
   * no-ops here made the DELETE/PATCH routes answer 200 for an id that was
   * never touched.
   */
  it("throws NOT_FOUND when removing a block that is not on the dashboard", () => {
    expect(() => store.removeBlock("ceo", "block-nope")).toThrow(/^NOT_FOUND/);
  });

  it("throws NOT_FOUND when removing a block pinned to the OTHER dashboard", () => {
    const cfoBlock = store.snapshot().dashboards.cfo.blocks[0];
    expect(() => store.removeBlock("ceo", cfoBlock.id)).toThrow(/^NOT_FOUND/);
    // Untouched on the dashboard that actually holds it.
    expect(store.snapshot().dashboards.cfo.blocks.map((b) => b.id)).toContain(
      cfoBlock.id,
    );
  });

  it("throws NOT_FOUND when moving a block that is not on the dashboard", () => {
    expect(() => store.moveBlock("ceo", "block-nope", "up")).toThrow(
      /^NOT_FOUND/,
    );
  });

  /**
   * A boundary move is NOT a not-found: the block exists and the order is
   * already what was asked for. It stays a silent, successful no-op — the
   * grid disables those buttons anyway (`../components/dashboard-grid.tsx`).
   */
  it("no-ops without throwing when a move would fall off either end", () => {
    const ids = () => store.snapshot().dashboards.ceo.blocks.map((b) => b.id);
    const before = ids();
    expect(() => store.moveBlock("ceo", before[0], "up")).not.toThrow();
    expect(() =>
      store.moveBlock("ceo", before[before.length - 1], "down"),
    ).not.toThrow();
    expect(ids()).toEqual(before);
  });
});
