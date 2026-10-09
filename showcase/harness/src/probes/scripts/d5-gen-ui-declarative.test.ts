import { describe, it, expect } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildDeclarativeAssertion,
  buildBaselineCapture,
  preNavigateRoute,
  GEN_UI_DECLARATIVE_PILLS,
} from "./d5-gen-ui-declarative.js";
import type { DeclarativeBaselineRef } from "./d5-gen-ui-declarative.js";

/** Counts: 0 = absent, >=1 = present. Tests express "present" with `1`
 *  unless they need to assert minCounts. */
type DeclarativeTestIdState = {
  card: number;
  metric: number;
  statusBadge: number;
  pieChart: number;
  barChart: number;
  dataTable: number;
  infoRow: number;
};

const ALL_FALSE: DeclarativeTestIdState = {
  card: 0,
  metric: 0,
  statusBadge: 0,
  pieChart: 0,
  barChart: 0,
  dataTable: 0,
  infoRow: 0,
};

type DeclarativeTestIdInput = Partial<{
  card: boolean | number;
  metric: boolean | number;
  statusBadge: boolean | number;
  pieChart: boolean | number;
  barChart: boolean | number;
  dataTable: boolean | number;
  infoRow: boolean | number;
}>;

function toCounts(state: DeclarativeTestIdInput): DeclarativeTestIdState {
  const num = (v: boolean | number | undefined): number =>
    typeof v === "number" ? v : v === true ? 1 : 0;
  return {
    card: num(state.card),
    metric: num(state.metric),
    statusBadge: num(state.statusBadge),
    pieChart: num(state.pieChart),
    barChart: num(state.barChart),
    dataTable: num(state.dataTable),
    infoRow: num(state.infoRow),
  };
}

function makePage(state: DeclarativeTestIdInput): Page {
  const filled = toCounts(state);
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return filled as unknown as R;
    },
  };
}

/** Page whose evaluate returns `state` a few times, then throws to
 *  short-circuit the 60s probe deadline so failing-path tests exit
 *  within the default vitest budget. The behaviour under test is
 *  "this state does NOT satisfy the pill" — the throw is a harness
 *  shortcut, not the production failure mode. */
function makeAbortingPage(state: DeclarativeTestIdInput): Page {
  const filled = toCounts(state);
  let calls = 0;
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      calls += 1;
      if (calls > 3) throw new Error("simulated probe abort");
      return filled as unknown as R;
    },
  };
}

function newBaseline(): DeclarativeBaselineRef {
  return { testIds: { ...ALL_FALSE }, captured: false };
}

function newCapturedBaseline(
  testIds: DeclarativeTestIdInput,
): DeclarativeBaselineRef {
  return { testIds: toCounts(testIds), captured: true };
}

describe("d5-gen-ui-declarative script", () => {
  it("registers under featureType 'gen-ui-declarative'", () => {
    const script = getD5Script("gen-ui-declarative");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-declarative.json");
  });

  it("preNavigateRoute resolves /demos/declarative-gen-ui", () => {
    expect(preNavigateRoute("gen-ui-declarative")).toBe(
      "/demos/declarative-gen-ui",
    );
  });

  it("buildTurns produces four per-pill turns mirroring suggestions.ts", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-declarative",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(4);
    expect(turns[0]!.input).toContain("sales dashboard");
    expect(turns[1]!.input).toContain("reps performing");
    expect(turns[2]!.input).toContain("at risk");
    expect(turns[3]!.input).toContain("biggest account");
  });

  it("each turn carries a preFill baseline-capture hook", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-declarative",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    for (const turn of turns) {
      expect(typeof turn.preFill).toBe("function");
      expect(typeof turn.assertions).toBe("function");
    }
  });

  it("GEN_UI_DECLARATIVE_PILLS covers all four pill topics", () => {
    const tags = GEN_UI_DECLARATIVE_PILLS.map((p) => p.tag);
    expect(tags).toEqual([
      "sales-dashboard",
      "team-performance",
      "at-risk",
      "top-account",
    ]);
  });

  it("hero pill requires the full composed dashboard, conjunctively", () => {
    const hero = GEN_UI_DECLARATIVE_PILLS.find(
      (p) => p.tag === "sales-dashboard",
    );
    expect(hero).toBeDefined();
    expect(hero!.expectedTestIds).toEqual([
      "declarative-metric",
      "declarative-pie-chart",
      "declarative-bar-chart",
    ]);
  });

  it("pills 2-4 each require a testid the hero pill does not mount", () => {
    const heroIds = new Set<string>(
      GEN_UI_DECLARATIVE_PILLS[0]!.expectedTestIds,
    );
    for (const pill of GEN_UI_DECLARATIVE_PILLS.slice(1)) {
      const distinguishing = (pill.expectedTestIds as readonly string[]).filter(
        (id) => !heroIds.has(id),
      );
      expect(distinguishing.length).toBeGreaterThan(0);
    }
  });

  it("baseline-capture writes the current testid state into the ref", async () => {
    const ref = newBaseline();
    const capture = buildBaselineCapture(ref);
    const page = makePage({ card: true, metric: true });
    await capture(page);
    expect(ref.captured).toBe(true);
    expect(ref.testIds.card).toBeGreaterThan(0);
    expect(ref.testIds.metric).toBeGreaterThan(0);
    expect(ref.testIds.statusBadge).toBe(0);
  });

  it("sales-dashboard assertion succeeds when ALL expected ids are newly mounted", async () => {
    const baseline = newCapturedBaseline({}); // empty DOM before pill
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-metric", "declarative-pie-chart", "declarative-bar-chart"],
      baseline,
    );
    const page = makePage({
      metric: true,
      pieChart: true,
      barChart: true,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("sales-dashboard assertion fails when only SOME expected ids are present", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-metric", "declarative-pie-chart", "declarative-bar-chart"],
      baseline,
    );
    // A lonely bar chart is not a dashboard — conjunctive check refuses.
    const page = makeAbortingPage({ barChart: true });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("team-performance assertion fails on leftover hero components only", async () => {
    // Simulate cross-pill leftover from the hero dashboard: card, metric
    // and charts are still mounted. team-performance requires data-table,
    // which the hero is steered not to use — leftovers do not pass.
    const baseline = newCapturedBaseline({
      card: true,
      metric: true,
      pieChart: true,
      barChart: true,
    });
    const assertion = buildDeclarativeAssertion(
      "team-performance",
      ["declarative-data-table"],
      baseline,
    );
    const page = makeAbortingPage({
      card: true,
      metric: true,
      pieChart: true,
      barChart: true,
    });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("at-risk assertion fails on leftover-only match (testid in baseline)", async () => {
    // Edge case: the expected testid IS present, but it was already
    // present in the baseline. Without the newly-mounted gate this
    // would trivially pass; with the gate it fails.
    const baseline = newCapturedBaseline({ statusBadge: true });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-status-badge"],
      baseline,
    );
    const page = makeAbortingPage({ statusBadge: true });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("at-risk assertion succeeds when status-badge is newly mounted", async () => {
    const baseline = newCapturedBaseline({ card: true });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-status-badge"],
      baseline,
    );
    const page = makePage({ card: true, statusBadge: true });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("top-account assertion succeeds when info-row is newly mounted", async () => {
    const baseline = newCapturedBaseline({ card: true, statusBadge: true });
    const assertion = buildDeclarativeAssertion(
      "top-account",
      ["declarative-info-row"],
      baseline,
    );
    const page = makePage({ card: true, statusBadge: true, infoRow: true });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when evaluate keeps reporting all-false past deadline", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-card", "declarative-metric"],
      baseline,
    );
    const page = makeAbortingPage({});
    await expect(assertion(page)).rejects.toThrow();
  });

  it("assertion fails when baseline was never captured", async () => {
    const baseline = newBaseline(); // captured: false
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-card", "declarative-metric"],
      baseline,
    );
    const page = makePage({ card: true, metric: true });
    await expect(assertion(page)).rejects.toThrow(/baseline was not captured/);
  });

  it("buildDeclarativeAssertion throws on unknown expected testid", () => {
    expect(() =>
      buildDeclarativeAssertion(
        "bad-pill",
        ["declarative-card", "definitely-unknown"],
        newCapturedBaseline({}),
      ),
    ).toThrow(/unknown expected testid/);
  });

  // ─── R2-F1: newly-mounted is a count delta, not boolean ─────────────
  //
  // Regression: prior fix migrated to numeric counts but kept
  // `!baseline[k]` in the newly-mounted predicate. `!3` is `false`, so
  // an expected testid whose baseline count was already >=1 was treated
  // as "not newly mounted" even when the current count grew.

  it("R2-F1: newly-mounted holds when baseline=0 and current>=1", async () => {
    const baseline = newCapturedBaseline({ metric: 0 });
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-metric", "declarative-pie-chart", "declarative-bar-chart"],
      baseline,
    );
    const page = makePage({ metric: 1, pieChart: 1, barChart: 1 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("R2-F1: newly-mounted holds when baseline=N and current=N+1 (count grew)", async () => {
    // Hero already painted 3 metric tiles into baseline. At-risk pill
    // mounts a 4th. Under the broken `!baseline[k]` predicate, !3 is
    // false, so the predicate wrongly says "not newly mounted" even
    // though current.metric grew from 3 to 4.
    const baseline = newCapturedBaseline({ metric: 3 });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-metric"],
      baseline,
    );
    const page = makePage({ metric: 4 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("R2-F1: newly-mounted fails when baseline=N and current=N (no growth)", async () => {
    // Hero already painted 3 metrics, at-risk pill arrives but no new
    // metrics mount — leftover-only, must fail.
    const baseline = newCapturedBaseline({ metric: 3 });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-metric"],
      baseline,
    );
    const page = makeAbortingPage({ metric: 3 });
    await expect(assertion(page)).rejects.toThrow();
  });

  // ─── R2-F2: minCounts must gate against leftover via delta ───────────
  //
  // Regression: minCounts checks `last[key] >= min` against absolute
  // counts. If hero already mounted 3 metrics and at-risk pill arrives
  // without producing any new metrics, the floor passes on leftover.
  // Fix: minCounts asserts `current - baseline >= min`.

  it("R2-F2: at-risk minCounts fails on hero leftover (no new metrics)", async () => {
    // Hero baseline: 3 metric tiles already mounted. At-risk pill
    // arrives but the renderer fails to mount any new metric tiles —
    // current.metric is still 3 (leftover). minCounts requires 3 new
    // metrics, so the assertion must fail.
    const baseline = newCapturedBaseline({ metric: 3 });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-status-badge"],
      baseline,
      { "declarative-status-badge": 3, "declarative-metric": 3 },
    );
    const page = makeAbortingPage({ metric: 3, statusBadge: 3 });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("R2-F2: at-risk minCounts passes when 3 new metrics + 3 new badges mount", async () => {
    // Hero baseline: 3 metric tiles already mounted. At-risk pill adds
    // 3 more (current = 6) AND 3 new status badges (baseline = 0,
    // current = 3). Delta meets minCounts for both.
    const baseline = newCapturedBaseline({ metric: 3 });
    const assertion = buildDeclarativeAssertion(
      "at-risk",
      ["declarative-status-badge"],
      baseline,
      { "declarative-status-badge": 3, "declarative-metric": 3 },
    );
    const page = makePage({ metric: 6, statusBadge: 3 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  // ─── R2-F7: hero pill enforces 4 KPI tiles via minCounts ─────────────

  it("R2-F7: hero pill carries minCounts requiring 4 newly-mounted metrics", () => {
    const hero = GEN_UI_DECLARATIVE_PILLS.find(
      (p) => p.tag === "sales-dashboard",
    );
    expect(hero).toBeDefined();
    const min = (hero as { minCounts?: Record<string, number> }).minCounts;
    expect(min).toBeDefined();
    expect(min!["declarative-metric"]).toBe(4);
  });

  it("R2-F7: hero pill fails when only 3 metrics mount (under-composition)", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-metric", "declarative-pie-chart", "declarative-bar-chart"],
      baseline,
      { "declarative-metric": 4 },
    );
    const page = makeAbortingPage({ metric: 3, pieChart: 1, barChart: 1 });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("R2-F7: hero pill passes when 4 metrics + pie + bar mount", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "sales-dashboard",
      ["declarative-metric", "declarative-pie-chart", "declarative-bar-chart"],
      baseline,
      { "declarative-metric": 4 },
    );
    const page = makePage({ metric: 4, pieChart: 1, barChart: 1 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  // ─── R2-F8: team-performance + top-account chart sibling asserts ─────

  it("R2-F8: team-performance pill carries minCounts requiring bar+table", () => {
    const tp = GEN_UI_DECLARATIVE_PILLS.find(
      (p) => p.tag === "team-performance",
    );
    expect(tp).toBeDefined();
    const min = (tp as { minCounts?: Record<string, number> }).minCounts;
    expect(min).toBeDefined();
    expect(min!["declarative-data-table"]).toBeGreaterThanOrEqual(1);
    expect(min!["declarative-bar-chart"]).toBeGreaterThanOrEqual(1);
  });

  it("R2-F8: team-performance fails when only data-table mounts (missing bar)", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "team-performance",
      ["declarative-data-table"],
      baseline,
      { "declarative-data-table": 1, "declarative-bar-chart": 1 },
    );
    const page = makeAbortingPage({ dataTable: 1 });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("R2-F8: team-performance passes when data-table + bar-chart both newly mounted", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "team-performance",
      ["declarative-data-table"],
      baseline,
      { "declarative-data-table": 1, "declarative-bar-chart": 1 },
    );
    const page = makePage({ dataTable: 1, barChart: 1 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("R2-F8: top-account pill carries minCounts requiring info-row+pie", () => {
    const ta = GEN_UI_DECLARATIVE_PILLS.find((p) => p.tag === "top-account");
    expect(ta).toBeDefined();
    const min = (ta as { minCounts?: Record<string, number> }).minCounts;
    expect(min).toBeDefined();
    expect(min!["declarative-info-row"]).toBeGreaterThanOrEqual(1);
    expect(min!["declarative-pie-chart"]).toBeGreaterThanOrEqual(1);
  });

  it("R2-F8: top-account fails when pie is leftover from hero (delta gate)", async () => {
    // Hero already mounted the pie chart. top-account arrives,
    // renderer mounts info-row but no new pie. Under absolute-count
    // gate this passes (pieChart >= 1). Under delta gate it fails.
    const baseline = newCapturedBaseline({ pieChart: 1 });
    const assertion = buildDeclarativeAssertion(
      "top-account",
      ["declarative-info-row"],
      baseline,
      { "declarative-info-row": 1, "declarative-pie-chart": 1 },
    );
    const page = makeAbortingPage({ pieChart: 1, infoRow: 1 });
    await expect(assertion(page)).rejects.toThrow();
  });

  it("R2-F8: top-account passes when info-row + new pie both mount", async () => {
    const baseline = newCapturedBaseline({ pieChart: 1 });
    const assertion = buildDeclarativeAssertion(
      "top-account",
      ["declarative-info-row"],
      baseline,
      { "declarative-info-row": 1, "declarative-pie-chart": 1 },
    );
    const page = makePage({ pieChart: 2, infoRow: 1 });
    await expect(assertion(page)).resolves.toBeUndefined();
  });
});
