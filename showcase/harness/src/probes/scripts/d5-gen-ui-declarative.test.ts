import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildDeclarativeAssertion,
  buildBaselineCapture,
  preNavigateRoute,
  GEN_UI_DECLARATIVE_PILLS,
  type DeclarativeBaselineRef,
} from "./d5-gen-ui-declarative.js";

type DeclarativeTestIdState = {
  card: boolean;
  metric: boolean;
  statusBadge: boolean;
  pieChart: boolean;
  barChart: boolean;
};

function makePage(state: Partial<DeclarativeTestIdState>): Page {
  const filled: DeclarativeTestIdState = {
    card: false,
    metric: false,
    statusBadge: false,
    pieChart: false,
    barChart: false,
    ...state,
  };
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return filled as unknown as R;
    },
  };
}

function newBaseline(): DeclarativeBaselineRef {
  return {
    testIds: {
      card: false,
      metric: false,
      statusBadge: false,
      pieChart: false,
      barChart: false,
    },
    captured: false,
  };
}

function newCapturedBaseline(
  testIds: Partial<DeclarativeTestIdState>,
): DeclarativeBaselineRef {
  return {
    testIds: {
      card: false,
      metric: false,
      statusBadge: false,
      pieChart: false,
      barChart: false,
      ...testIds,
    },
    captured: true,
  };
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
    expect(turns[0]!.input).toContain("KPI dashboard");
    expect(turns[1]!.input).toContain("pie chart");
    expect(turns[2]!.input).toContain("bar chart");
    expect(turns[3]!.input).toContain("status report");
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

  it("GEN_UI_DECLARATIVE_PILLS covers all four catalog families", () => {
    const tags = GEN_UI_DECLARATIVE_PILLS.map((p) => p.tag);
    expect(tags).toEqual([
      "kpi-dashboard",
      "pie-chart",
      "bar-chart",
      "status-report",
    ]);
  });

  it("status-report pill requires the distinguishing status-badge testid", () => {
    const statusReport = GEN_UI_DECLARATIVE_PILLS.find(
      (p) => p.tag === "status-report",
    );
    expect(statusReport).toBeDefined();
    expect(statusReport!.expectedTestIds).toEqual(["declarative-status-badge"]);
    // declarative-card alone must NOT satisfy status-report — pill 1
    // (kpi-dashboard) leaves a card in the DOM, so requiring status-badge
    // is what prevents trivial passes via leftover.
    expect(
      (statusReport!.expectedTestIds as readonly string[]).includes(
        "declarative-card",
      ),
    ).toBe(false);
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

  it("kpi-dashboard assertion succeeds when ALL expected ids are newly mounted", async () => {
    const baseline = newCapturedBaseline({}); // empty DOM before pill
    const assertion = buildDeclarativeAssertion(
      "kpi-dashboard",
      ["declarative-card", "declarative-metric"],
      baseline,
    );
    const page = makePage({ card: true, metric: true });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("kpi-dashboard assertion fails when only SOME expected ids are present", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "kpi-dashboard",
      ["declarative-card", "declarative-metric"],
      baseline,
    );
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        // Return partial-match state for the first few polls so the
        // assertion's `allPresent && anyNewlyMounted` gate sees the
        // partial mount and refuses to pass; then throw to short-
        // circuit the 60s deadline so the test exits within the
        // default 5s vitest budget. The behaviour we're verifying is
        // "partial match does NOT satisfy the pill" — the throw is a
        // test-harness shortcut, not the production failure mode.
        if (calls > 3) throw new Error("simulated probe abort");
        return {
          card: true,
          metric: false,
          statusBadge: false,
          pieChart: false,
          barChart: false,
        } as unknown as R;
      },
    };
    // We expect a rejection (NOT a successful resolve) — proving the
    // partial-mount state did not satisfy the conjunctive check.
    await expect(assertion(page)).rejects.toThrow();
  });

  it("status-report assertion fails when only leftover declarative-card is present", async () => {
    // Simulate cross-pill leftover from kpi-dashboard: card was already
    // mounted before status-report ran. status-report no longer accepts
    // card as a satisfying testid, so the leftover does not pass.
    const baseline = newCapturedBaseline({ card: true, metric: true });
    const assertion = buildDeclarativeAssertion(
      "status-report",
      ["declarative-status-badge"],
      baseline,
    );
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        if (calls > 3) throw new Error("simulated probe abort");
        // Final state still only has card+metric (leftover) — no status-badge.
        return {
          card: true,
          metric: true,
          statusBadge: false,
          pieChart: false,
          barChart: false,
        } as unknown as R;
      },
    };
    // Status-report cannot pass without `declarative-status-badge`
    // newly mounted — a card-only DOM is rejected.
    await expect(assertion(page)).rejects.toThrow();
  });

  it("status-report assertion fails on leftover-only match (testid in baseline)", async () => {
    // Edge case: the expected testid IS present, but it was already
    // present in the baseline. Without the newly-mounted gate this
    // would trivially pass; with the gate it fails.
    const baseline = newCapturedBaseline({ statusBadge: true });
    const assertion = buildDeclarativeAssertion(
      "status-report",
      ["declarative-status-badge"],
      baseline,
    );
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        if (calls > 3) throw new Error("simulated probe abort");
        return {
          card: false,
          metric: false,
          statusBadge: true,
          pieChart: false,
          barChart: false,
        } as unknown as R;
      },
    };
    // Even though status-badge is "present", it was already present
    // in the baseline — `anyNewlyMounted` is false, so the assertion
    // refuses to pass.
    await expect(assertion(page)).rejects.toThrow();
  });

  it("status-report assertion succeeds when status-badge is newly mounted", async () => {
    const baseline = newCapturedBaseline({ card: true });
    const assertion = buildDeclarativeAssertion(
      "status-report",
      ["declarative-status-badge"],
      baseline,
    );
    const page = makePage({ card: true, statusBadge: true });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("pie-chart assertion succeeds when pie-chart testid is newly mounted", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "pie-chart",
      ["declarative-pie-chart"],
      baseline,
    );
    const page = makePage({ pieChart: true });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when evaluate keeps reporting all-false past deadline", async () => {
    const baseline = newCapturedBaseline({});
    const assertion = buildDeclarativeAssertion(
      "kpi-dashboard",
      ["declarative-card", "declarative-metric"],
      baseline,
    );
    let calls = 0;
    const fastPage: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        if (calls > 3) throw new Error("simulated probe abort");
        return {
          card: false,
          metric: false,
          statusBadge: false,
          pieChart: false,
          barChart: false,
        } as unknown as R;
      },
    };
    await expect(assertion(fastPage)).rejects.toThrow();
  });

  it("assertion fails when baseline was never captured", async () => {
    const baseline = newBaseline(); // captured: false
    const assertion = buildDeclarativeAssertion(
      "kpi-dashboard",
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
