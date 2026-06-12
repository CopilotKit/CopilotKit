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

type DeclarativeTestIdState = {
  card: boolean;
  metric: boolean;
  statusBadge: boolean;
  pieChart: boolean;
  barChart: boolean;
  dataTable: boolean;
  infoRow: boolean;
};

const ALL_FALSE: DeclarativeTestIdState = {
  card: false,
  metric: false,
  statusBadge: false,
  pieChart: false,
  barChart: false,
  dataTable: false,
  infoRow: false,
};

function makePage(state: Partial<DeclarativeTestIdState>): Page {
  const filled: DeclarativeTestIdState = { ...ALL_FALSE, ...state };
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
function makeAbortingPage(state: Partial<DeclarativeTestIdState>): Page {
  const filled: DeclarativeTestIdState = { ...ALL_FALSE, ...state };
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
  testIds: Partial<DeclarativeTestIdState>,
): DeclarativeBaselineRef {
  return { testIds: { ...ALL_FALSE, ...testIds }, captured: true };
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
    expect(ref.testIds.card).toBe(true);
    expect(ref.testIds.metric).toBe(true);
    expect(ref.testIds.statusBadge).toBe(false);
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
});
