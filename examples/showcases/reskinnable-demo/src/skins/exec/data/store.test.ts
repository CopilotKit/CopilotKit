import { beforeEach, describe, expect, it } from "vitest";
import { isBreach } from "./derive";
import { storeErrorResponse } from "./store-errors";
import * as store from "./store";
import type { BlockSpec, DashboardId, MetricPoint } from "./types";

beforeEach(() => store.reset());

/** Strips every block off a dashboard, leaving it legitimately blank. */
function emptyDashboard(id: DashboardId): void {
  // The ids are read once, up front, so the loop below is driven by a plain
  // list of strings rather than by anything `removeBlock` can reach.
  const blockIds = store.snapshot().dashboards[id].blocks.map((b) => b.id);
  for (const blockId of blockIds) store.removeBlock(id, blockId);
  expect(store.snapshot().dashboards[id].blocks).toHaveLength(0);
}

/**
 * Every member a plain `{}` inherits from `Object.prototype`.
 *
 * `DashboardId` is a two-member union, but the value reaching the store is a
 * URL path segment (`/api/exec/v1/dashboards/<id>/blocks`) or an agent-supplied
 * argument — a `string` wearing a cast. A plain-object index walks the
 * PROTOTYPE CHAIN, so each of these resolves to a truthy INHERITED member
 * rather than to `undefined`, and a `!dashboard` guard waves it straight
 * through to `undefined.blocks`. `__proto__` is the worst of them: the lookup
 * yields `Object.prototype` itself, an object, so even a `typeof === "object"`
 * guard would agree it is a dashboard.
 *
 * Same hazard, same list as `src/shell/registry.test.ts` — see
 * `src/shell/registry.ts` for the house treatment.
 */
const INHERITED_KEYS: readonly string[] = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
];

/** Pins one freshly-built block onto `id` and returns its block id. */
function pinOnly(id: DashboardId, spec: BlockSpec): string {
  emptyDashboard(id);
  const draft = store.createDraftBlock(spec);
  store.addBlockToDashboard(id, draft.id);
  return draft.id;
}

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
    // EVERY one of them, as the name says — this checked `revenue` alone, so
    // a metric seeded with a short (or missing) series was green here and
    // only visible as a stunted chart on stage.
    const companyWide = store
      .snapshot()
      .metricDefs.filter((d) => !d.byDepartment);
    expect(companyWide.length).toBeGreaterThan(1);
    for (const def of companyWide) {
      const rows = store.metricSeries({ metricId: def.id });
      // One row per period at `department: "all"`, and 24 distinct periods.
      expect(rows, def.id).toHaveLength(24);
      expect(new Set(rows.map((r) => r.period)).size, def.id).toBe(24);
    }
  });

  /**
   * THE INVARIANT `exceptions()`' `explained` KEY RESTS ON. A `Narrative`
   * names a `(metricId, period)` and nothing else, so filing one clears every
   * DEPARTMENT's breach of that metric at that period. That is only honest
   * while no metric breaches in more than one department at once — which is a
   * property of the SEED, not of the schema, and therefore has to be asserted
   * rather than assumed. See the decision comment on `exceptions()` in
   * `store.ts` for why the key stays narrow instead of the schema widening.
   *
   * A reseed that spread one metric's breaches across two departments would
   * otherwise let a single narrative about Distribution clear an unwritten-up
   * Manufacturing overrun, and the board pack would publish with it inside.
   */
  it("keeps every breaching metric's breaches inside ONE department, so one narrative can honestly clear them", () => {
    const departmentsByMetric = new Map<string, Set<string>>();
    for (const e of store.exceptions()) {
      const seen = departmentsByMetric.get(e.metricId) ?? new Set<string>();
      seen.add(e.department);
      departmentsByMetric.set(e.metricId, seen);
    }
    expect(departmentsByMetric.size).toBeGreaterThan(0);
    for (const [metricId, departments] of departmentsByMetric) {
      expect(
        [...departments],
        `${metricId} breaches in more than one department, so one narrative would clear both`,
      ).toHaveLength(1);
    }
  });

  /**
   * The defs accessor is the cheap read: `snapshot()` recomputes `exceptions()`
   * over every point in the ledger, which a caller that only wants labels and
   * thresholds should not have to pay for. Same defs either way.
   */
  it("exposes the metric defs without recomputing exceptions", () => {
    expect(store.metricDefs()).toEqual(store.snapshot().metricDefs);
    expect(store.metricDefs().length).toBeGreaterThan(0);
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
    const departments = [
      "manufacturing",
      "distribution",
      "field-services",
      "corporate",
    ] as const;
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
  /**
   * Pinned against a HAND-COMPUTED number, not against a re-expression of the
   * formula: `expect(variancePct(p)).toBeCloseTo((p.actual - p.plan) / p.plan)`
   * restates the implementation, so swapping the denominator (`/ actual`,
   * `/ forecast`) mutates both sides identically and the test still passes.
   * 25/100 vs 25/125 vs 25/110 are three different numbers here, and the
   * exact-equality assertion separates all three.
   */
  it("derives variance as (actual - plan) / plan — signed, plan-denominated", () => {
    const point = {
      metricId: "revenue",
      period: "2024-01",
      department: "all",
      plan: 100,
      actual: 125,
      forecast: 110,
    } as const;
    expect(store.variancePct(point)).toBe(0.25); // NOT 0.2 (/actual), NOT ~0.1364 (/forecast)
    expect(store.variancePct({ ...point, actual: 80 })).toBe(-0.2); // sign preserved
  });
  it("derives variance from the ledger's own points, never stores it", () => {
    const p = store.metricSeries({ metricId: "revenue", months: 1 })[0];
    // Full float precision, not toBeCloseTo's default 2 decimals: the seeded
    // revenue point sits at -2% vs plan, and /actual vs /plan differ only in
    // the third decimal there.
    expect(store.variancePct(p)).toBe((p.actual - p.plan) / p.plan);
    expect(store.variancePct(p)).not.toBe((p.actual - p.plan) / p.actual);
    expect("variancePct" in p).toBe(false);
  });
  /**
   * A POINT WITH NO PLAN HAS NO VARIANCE FROM PLAN, so it cannot breach one.
   * `variancePct` divides by plan, and `Math.abs(Infinity) > thresholdPct` is
   * true for every threshold that exists — so a zero-planned point breached
   * PERMANENTLY: an exception no narrative could ever retire (a filing flips
   * `explained`, never the divide), blocking the publish gate while showing
   * the operator a blank where its variance should be, because
   * `Exception.variancePct` is typed `number` and `JSON.stringify` writes
   * `Infinity` as `null`. The `NaN` twin (plan and actual both zero) answered
   * the opposite unfounded thing — `NaN > x` is false, so a metric with no
   * plan at all was silently in the clear. Both are now the same explicit
   * "no variance data" answer.
   */
  it("never breaches on a point with no usable plan, in either non-finite direction", () => {
    const def = store.snapshot().metricDefs.find((d) => d.id === "opex")!;
    const point = (plan: number, actual: number): MetricPoint => ({
      metricId: "opex",
      period: "2024-01",
      department: "all",
      plan,
      actual,
      forecast: actual,
    });

    // The non-finite variances themselves, so the premise is on the record
    // rather than assumed: this is what the divide produces.
    expect(Number.isFinite(store.variancePct(point(0, 5)))).toBe(false); // Infinity
    expect(Number.isFinite(store.variancePct(point(0, 0)))).toBe(false); // NaN

    expect(isBreach(def, point(0, 5))).toBe(false); // was: breached forever
    expect(isBreach(def, point(0, -5))).toBe(false); // -Infinity, same answer
    expect(isBreach(def, point(0, 0))).toBe(false);
    expect(isBreach(def, point(Number.POSITIVE_INFINITY, 5))).toBe(false);
    expect(isBreach(def, point(5, Number.NaN))).toBe(false);

    // ...and a real, finite variance still decides normally on both sides of
    // the threshold, so this is a guard and not a blanket suppression.
    expect(isBreach(def, point(100, 100 + def.thresholdPct * 100 + 1))).toBe(
      true,
    );
    expect(isBreach(def, point(100, 100 + def.thresholdPct * 100 - 1))).toBe(
      false,
    );
  });

  /**
   * A NARRATIVE CLEARS ITS OWN PERIOD AND NO OTHER. `explained` matches on
   * `(metricId, period)`; dropping the PERIOD half leaves every other test in
   * this file green, because they all file against the breach's own period —
   * and it would mean a narrative filed about last quarter's opex overrun
   * silently cleared this month's, publishing a board pack whose only
   * explanation is about a period the pack does not report on.
   */
  it("clears a breach only with a narrative filed for its OWN period", () => {
    const breach = store.exceptions().find((e) => !e.explained);
    expect(
      breach,
      "seed no longer carries an unexplained breach",
    ).toBeDefined();

    store.fileNarrative({
      metricId: breach!.metricId,
      // A real earlier period in the seeded 24-month window, not a nonsense
      // string: this is the stale-narrative case, not a malformed one.
      period: store.metricSeries({ metricId: breach!.metricId })[0].period,
      code: "VAR-TIMING",
      body: "About an entirely different month.",
      source: "typed",
    });

    const after = store
      .exceptions()
      .find(
        (e) => e.metricId === breach!.metricId && e.period === breach!.period,
      );
    expect(after!.explained).toBe(false);
    // ...and the gate agrees with the flag, rather than only the flag moving.
    expect(store.publishPack("ceo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: false,
      code: "UNEXPLAINED_VARIANCE",
    });
  });

  /**
   * `pack.narrativeIds` IS THE RECORD OF WHAT EXPLAINS THIS PACK, and a pack
   * reports one period. `publishPack` skips narratives filed for any other
   * period; dropping that half of its filter leaves every other publish test
   * green (they file only at the latest period) while quietly attaching a
   * narrative about an older month to a pack that never mentions it —
   * inflating the pack's explanation count with a document a reader following
   * the id would find is about something else.
   */
  it("records only narratives filed for the period the pack reports on", () => {
    const latest = store.exceptions()[0].period;
    const stale = store.metricSeries({ metricId: "opex" })[0].period;
    expect(stale).not.toBe(latest);

    // A stale filing for a metric the CFO dashboard DOES reference, so only
    // the period half of the filter can exclude it.
    const staleNarrative = store.fileNarrative({
      metricId: "opex",
      period: stale,
      code: "VAR-ONEOFF",
      body: "Filed months ago, about a closed-out month.",
      source: "typed",
    });
    for (const b of store.exceptions()) {
      store.fileNarrative({
        metricId: b.metricId,
        period: b.period,
        code: "VAR-TIMING",
        body: "Current-period explanation.",
        source: "typed",
      });
    }

    const r = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;

    expect(r.pack.narrativeIds).not.toContain(staleNarrative.id);
    const byId = new Map(store.snapshot().narratives.map((n) => [n.id, n]));
    for (const id of r.pack.narrativeIds) {
      expect(byId.get(id)!.period, `narrative ${id}`).toBe(latest);
    }
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
    const filed = store.exceptions().map((b) =>
      store.fileNarrative({
        metricId: b.metricId,
        period: b.period,
        code: "VAR-TIMING",
        body: "Shipment timing shift.",
        source: "typed",
      }),
    );
    const r = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;

    // The pack is the RECORD of what was published, so both id lists have to
    // be real: `blockIds` is exactly the dashboard's blocks in order, and
    // `narrativeIds` covers the metrics this dashboard references (opex,
    // burnRate) and no others — dsoDays is on no CFO block.
    expect(r.pack.dashboardId).toBe("cfo");
    expect(r.pack.blockIds).toEqual(
      store.snapshot().dashboards.cfo.blocks.map((b) => b.id),
    );
    expect(r.pack.blockIds.length).toBeGreaterThan(0);

    const byId = new Map(store.snapshot().narratives.map((n) => [n.id, n]));
    expect(new Set(r.pack.narrativeIds).size).toBe(r.pack.narrativeIds.length);
    expect(
      new Set(r.pack.narrativeIds.map((id) => byId.get(id)?.metricId)),
    ).toEqual(new Set(["opex", "burnRate"]));
    for (const id of r.pack.narrativeIds) {
      expect(filed.map((n) => n.id)).toContain(id);
    }
    expect(store.snapshot().packs.map((p) => p.id)).toEqual([r.pack.id]);
  });

  /**
   * The gate is PER DASHBOARD. Deleting `publishPack`'s dashboard filter — so
   * every unexplained breach on the ledger blocks every pack — leaves the
   * refusal tests above green, because the seeded dashboards happen to
   * reference breaching metrics. This is the test that dies: a dashboard
   * bound only to `revenue` (a deliberate seeded NON-breach) must publish
   * while opex/burnRate/dsoDays are all still unexplained.
   */
  it("scopes the publish gate to the metrics THIS dashboard references", () => {
    pinOnly("cfo", {
      kind: "metricTile",
      title: "Revenue vs plan",
      metricId: "revenue",
      department: "all",
      compare: "plan",
    });
    expect(
      store.exceptions().filter((e) => !e.explained).length,
    ).toBeGreaterThan(0);
    expect(store.publishPack("cfo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: true,
    });
    // ...and the CEO board, whose exceptionList makes its gate consider every
    // metric, still refuses on the very breaches the CFO pack ignored.
    expect(store.publishPack("ceo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: false,
      code: "UNEXPLAINED_VARIANCE",
    });
  });

  /**
   * THE VACUOUS-GATE GUARD. `referencedMetrics` reports `includesAll: false`
   * and an EMPTY metric set for a dashboard with no metric-bound and no
   * `exceptionList` block, so the breach filter matched nothing and an empty
   * board published `ok: true` with three unexplained breaches sitting on the
   * ledger — the demo's climactic 422 refusal erased by clicking Remove on
   * every block. A board pack with nothing metric-bound in it is refused on
   * its own terms, under its OWN code: reporting it as UNEXPLAINED_VARIANCE
   * would name breaches the pack does not contain.
   */
  it("refuses to publish a dashboard with NO metric-bearing blocks (422 EMPTY_DASHBOARD)", () => {
    emptyDashboard("cfo");
    const r = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(r).toMatchObject({
      ok: false,
      status: 422,
      code: "EMPTY_DASHBOARD",
    });
    expect(store.snapshot().packs).toHaveLength(0);
    expect(
      store.exceptions().filter((e) => !e.explained).length,
    ).toBeGreaterThan(0);
    if (!r.ok && r.code === "EMPTY_DASHBOARD") {
      expect(r.message).toMatch(/metric/i);
      // The withheld narrative vocabulary never rides out on an error the
      // routes forward to the agent.
      expect(r.message).not.toMatch(/VAR-/);
      expect(r.message).not.toContain(store.COUNTERSIGN_PIN);
    }
  });

  it("refuses an initiativeTable-only dashboard the same way — it binds no metric", () => {
    pinOnly("cfo", { kind: "initiativeTable", title: "Key Initiatives" });
    expect(store.publishPack("cfo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: false,
      status: 422,
      code: "EMPTY_DASHBOARD",
    });
  });

  /**
   * An `exceptionList`-only board is NOT empty: that block surfaces every
   * metric's exceptions, so its gate considers ALL metrics and must still
   * refuse on variance. Guards the fix above against over-refusing.
   */
  it("treats an exceptionList-only dashboard as metric-bearing, still gated on variance", () => {
    pinOnly("cfo", { kind: "exceptionList", title: "Open Exceptions" });
    expect(store.publishPack("cfo", store.COUNTERSIGN_PIN)).toMatchObject({
      ok: false,
      status: 422,
      code: "UNEXPLAINED_VARIANCE",
    });
  });

  it("checks the countersign PIN before the empty-dashboard refusal", () => {
    emptyDashboard("cfo");
    expect(store.publishPack("cfo", "0000")).toMatchObject({
      ok: false,
      status: 403,
      code: "BAD_COUNTERSIGN",
    });
  });

  it("refuses to publish an unknown dashboard with a mapped NOT_FOUND, not a crash", () => {
    expect(() =>
      store.publishPack("nope" as DashboardId, store.COUNTERSIGN_PIN),
    ).not.toThrow();
    expect(
      store.publishPack("nope" as DashboardId, store.COUNTERSIGN_PIN),
    ).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });

  /**
   * The same refusal for a dashboardId that NAMES an `Object.prototype` member.
   *
   * This one is not a variant of the test above, it is the contract: every
   * relay above `publishPack` — the POST packs route, `publish_board_pack` in
   * `agent.ts`, the countersign card — forwards the returned `code`/`status`
   * verbatim and NONE of them wraps the call, so a throw here is an unhandled
   * rejection where a 404 body belongs. Asserted per key, and for the RETURN
   * as well as the absence of a throw, because a lookup that finds an inherited
   * member fails differently from one that finds nothing.
   */
  it("refuses — never throws — for a dashboardId naming an Object.prototype member", () => {
    for (const key of INHERITED_KEYS) {
      const call = () =>
        store.publishPack(key as DashboardId, store.COUNTERSIGN_PIN);
      expect(call, `publishPack("${key}") must not throw`).not.toThrow();
      expect(call(), `publishPack("${key}")`).toMatchObject({
        ok: false,
        status: 404,
        code: "NOT_FOUND",
      });
    }
  });

  /**
   * Two narratives for the SAME (metricId, period) — the operator types one
   * and the agent files another from the ingested memo, which beats 3a/3d do
   * back to back — must not both land in the pack: `narrativeIds` is the
   * record of WHAT EXPLAINS the pack, and one explanation counted twice
   * inflates every count read off it.
   */
  it("records at most one narrative per (metricId, period) in a pack", () => {
    for (const b of store.exceptions()) {
      store.fileNarrative({
        metricId: b.metricId,
        period: b.period,
        code: "VAR-TIMING",
        body: "Typed by the chief of staff.",
        source: "typed",
      });
      store.fileNarrative({
        metricId: b.metricId,
        period: b.period,
        code: "VAR-ONEOFF",
        body: "Re-filed from the ingested budget memo.",
        source: "ingested-memo",
      });
    }
    const r = store.publishPack("cfo", store.COUNTERSIGN_PIN);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;

    const byId = new Map(store.snapshot().narratives.map((n) => [n.id, n]));
    const pairs = r.pack.narrativeIds.map((id) => {
      const n = byId.get(id);
      expect(n, `pack narrative ${id} is not on the ledger`).toBeDefined();
      return `${n!.metricId}/${n!.period}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
    // Both filings are still ON the ledger — dedupe is about the pack record.
    expect(store.snapshot().narratives.length).toBeGreaterThan(pairs.length);
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

/**
 * THE `months` WINDOW CONTRACT. `months` reaches here straight off a
 * `BlockSpec` (`trendLine`'s window) and off the agent's `get_metrics`
 * arguments, so 0, a negative and a NaN are all reachable inputs, not
 * hypotheticals. The old `if (q.months)` guard made 0 mean "all 24 periods"
 * (falsy, so no narrowing at all) while -3 meant `slice(-(-3))` === `slice(3)`
 * — the OLDEST 21 periods, an inverted window silently answering a chart that
 * asked for the newest three.
 */
describe("metricSeries window", () => {
  const periodsOf = (months?: number) => [
    ...new Set(
      store.metricSeries({ metricId: "revenue", months }).map((p) => p.period),
    ),
  ];

  it("keeps the last N DISTINCT periods for a positive N", () => {
    const all = periodsOf();
    expect(all).toHaveLength(24);
    expect(periodsOf(3)).toEqual(all.slice(-3));
    expect(periodsOf(1)).toEqual(all.slice(-1));
  });

  it("returns the full history for an omitted or zero window", () => {
    expect(periodsOf(undefined)).toHaveLength(24);
    expect(periodsOf(0)).toHaveLength(24);
  });

  /** Never an INVERTED window: -3 must not hand back the oldest 21 periods. */
  it("returns the full history for a negative or non-finite window", () => {
    const all = periodsOf();
    expect(periodsOf(-3)).toEqual(all);
    expect(periodsOf(Number.NaN)).toEqual(all);
    expect(periodsOf(Number.POSITIVE_INFINITY)).toEqual(all);
  });

  it("floors a fractional window rather than dropping a partial period", () => {
    const all = periodsOf();
    expect(periodsOf(2.7)).toEqual(all.slice(-2));
  });

  it("windows by PERIOD, not by row, when a metric spans several departments", () => {
    const rows = store.metricSeries({ metricId: "opex", months: 2 });
    const periods = [...new Set(rows.map((r) => r.period))];
    expect(periods).toHaveLength(2);
    // opex is byDepartment: 5 rows ("all" + 4 departments) per period, so a
    // row-slice would have truncated mid-period.
    expect(rows).toHaveLength(10);
  });

  /**
   * The `department` filter and the `months` window COMPOSE — this is the
   * combination the header describes and the test above did not actually
   * make: it named a department filter and passed none, so `department` was
   * exercised nowhere in this file and a filter dropped (or applied after the
   * window, narrowing the window's own period set) was green.
   */
  it("applies a department filter and the period window together", () => {
    const all = store.metricSeries({ metricId: "opex", months: 2 });
    const distribution = store.metricSeries({
      metricId: "opex",
      department: "distribution",
      months: 2,
    });

    // One row per period once the department is pinned — not the 10 above.
    expect(distribution).toHaveLength(2);
    expect(distribution.every((r) => r.department === "distribution")).toBe(
      true,
    );
    // The SAME two periods the unfiltered window keeps: filtering first must
    // not shrink the window the filtered rows are drawn from.
    expect(distribution.map((r) => r.period)).toEqual([
      ...new Set(all.map((r) => r.period)),
    ]);
    // And the filter narrows rather than truncating: the full unwindowed
    // department series is still all 24 periods.
    expect(
      store.metricSeries({ metricId: "opex", department: "distribution" }),
    ).toHaveLength(24);
  });
});

describe("dashboard blocks", () => {
  /**
   * An unknown dashboard id must arrive as the SAME coded refusal a bad block
   * id gets, not as a raw `TypeError: Cannot read properties of undefined` —
   * `store-errors.ts` maps `NOT_FOUND` to 404, and an unmapped throw is a 500
   * with no actionable body for the agent or the presenter.
   */
  it("throws NOT_FOUND — never a raw TypeError — for an unknown dashboard id", () => {
    const nope = "nope" as DashboardId;
    for (const call of [
      () => store.addBlockToDashboard(nope, "seed-ceo-revenue"),
      () => store.removeBlock(nope, "seed-ceo-revenue"),
      () => store.moveBlock(nope, "seed-ceo-revenue", "up"),
    ]) {
      expect(call).toThrow(/^NOT_FOUND/);
      expect(call).toThrow(/nope/);
      expect(call).not.toThrow(TypeError);
    }
  });

  /**
   * …and the same for an id that names an `Object.prototype` member, which the
   * test above cannot cover: `"nope"` misses the index and lands on
   * `undefined`, while `"constructor"` HITS the prototype chain and lands on a
   * truthy non-dashboard, so only this case reaches `undefined.blocks` past a
   * `!dashboard` guard. `store-errors.ts` maps nothing for the resulting
   * TypeError, so the block routes answered 500 with no body.
   */
  it("throws NOT_FOUND for a dashboardId naming an Object.prototype member", () => {
    for (const key of INHERITED_KEYS) {
      const id = key as DashboardId;
      for (const call of [
        () => store.addBlockToDashboard(id, "seed-ceo-revenue"),
        () => store.removeBlock(id, "seed-ceo-revenue"),
        () => store.moveBlock(id, "seed-ceo-revenue", "up"),
      ]) {
        expect(call, `dashboardId "${key}"`).toThrow(/^NOT_FOUND/);
        expect(call, `dashboardId "${key}"`).not.toThrow(TypeError);
      }
    }
  });

  /**
   * `render_metric_block`'s `execute` guard (agent.ts) already screens a
   * missing `metricId` before calling `store.createDraftBlock`, so this
   * only fires for some OTHER caller — but a bad spec must never be
   * STORED: it would still be there for the ledger GET route to rebuild
   * ops from on a later read, on a call that expects to succeed. See
   * `build-block-ops.ts`'s `assertValidBlockSpec`, which this delegates to.
   */
  it("refuses to create a draft block from an invalid spec", () => {
    const missingMetricId = {
      kind: "metricTile",
      title: "Revenue vs plan",
    } as BlockSpec;
    expect(() => store.createDraftBlock(missingMetricId)).toThrow(
      /^METRIC_ID_REQUIRED/,
    );
  });

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
  /**
   * BOTH directions have to move something. The old version only ever moved
   * the second block "up" and asserted the head — "down" was exercised solely
   * by the boundary no-op test below, so a `moveBlock` that ignored
   * `direction: "down"` entirely was green.
   */
  it("swaps a block with its neighbour in BOTH directions, and removes it", () => {
    const ids = () => store.snapshot().dashboards.ceo.blocks.map((b) => b.id);
    const [first, second, third] = ids();
    expect(third, "ceo seed needs three blocks for this test").toBeDefined();

    store.moveBlock("ceo", second, "up");
    expect(ids()).toEqual([second, first, third]);

    // A real swap downwards: `first` moves past `third`, and only those two
    // positions change.
    store.moveBlock("ceo", first, "down");
    expect(ids()).toEqual([second, third, first]);

    store.removeBlock("ceo", first);
    expect(ids()).toEqual([second, third]);
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

/**
 * The `CODE: message` convention, from the throw site to the HTTP status.
 * These are the store's own throws going through the one table the block
 * routes share, so they live with the mutators that raise them.
 */
describe("store throws → storeErrorResponse", () => {
  const parse = async (error: unknown) => {
    const res = storeErrorResponse(error);
    return res && { status: res.status, body: await res.json() };
  };

  it("maps a real store throw to its status and forwards the message verbatim", async () => {
    const thrown = (() => {
      try {
        store.removeBlock("ceo", "block-nope");
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(await parse(thrown)).toEqual({
      status: 404,
      body: {
        error: "NOT_FOUND",
        message: `NOT_FOUND: no block "block-nope" on the "ceo" dashboard`,
      },
    });
  });

  /**
   * A thrown value that is not `instanceof Error` still has to map. Two ways
   * that happens for real: a cross-realm Error (thrown through a different
   * JS realm — Next's server/edge boundaries, a vm context — where the
   * `instanceof` identity check fails even though it IS an Error), and a
   * plain object thrown by a helper. `String(value)` was the fallback, and it
   * stringifies the FIRST as `"Error: NOT_FOUND: …"` and the SECOND as
   * `"[object Object]"` — so the code parsed out was `"Error"` or
   * `"[object Object]"`, never a real code, and every one of those became an
   * unmapped re-throw: a 500 with a stack where a 404 was sitting right there
   * in the message.
   */
  it("maps a non-Error throw that carries the same coded message", async () => {
    const crossRealm = { name: "Error", message: 'NOT_FOUND: no block "x"' };
    expect(await parse(crossRealm)).toEqual({
      status: 404,
      body: { error: "NOT_FOUND", message: 'NOT_FOUND: no block "x"' },
    });
    expect(await parse('ALREADY_PINNED: block "x" is on "ceo"')).toEqual({
      status: 409,
      body: {
        error: "ALREADY_PINNED",
        message: 'ALREADY_PINNED: block "x" is on "ceo"',
      },
    });
  });

  /**
   * `null` (→ the call site re-throws for Next to log with a stack), never a
   * response built from a bogus status. A prototype-chain key is the case the
   * `Map` exists for: on a plain-object table `"toString"` resolves to a
   * truthy FUNCTION, which sails past an `=== undefined` guard and reaches
   * `Response.json(body, { status: fn })` — a RangeError at the route, i.e. a
   * 500 with a confusing stack, not the honest re-throw below.
   */
  it("returns null for an uncoded throw and for prototype-chain keys", async () => {
    expect(await parse(new Error("kaboom"))).toBeNull();
    expect(await parse(new Error("toString: not a code"))).toBeNull();
    expect(await parse(new Error("constructor: not a code"))).toBeNull();
    expect(await parse(new Error("__proto__: not a code"))).toBeNull();
    expect(await parse(undefined)).toBeNull();
  });
});
