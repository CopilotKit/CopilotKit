import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildAgentStateAssertion,
  buildBaselineCapture,
  GEN_UI_AGENT_PILLS,
  type AgentStepBaselineRef,
} from "./d5-gen-ui-agent.js";

function makePage(state: { stepCount: number; stepText: string }): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return state as unknown as R;
    },
  };
}

function newBaseline(): AgentStepBaselineRef {
  return { stepCount: 0, stepText: "", captured: false };
}

function newCapturedBaseline(state: {
  stepCount: number;
  stepText: string;
}): AgentStepBaselineRef {
  return { ...state, captured: true };
}

describe("d5-gen-ui-agent script", () => {
  it("registers under featureType 'gen-ui-agent'", () => {
    const script = getD5Script("gen-ui-agent");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-agent.json");
  });

  it("buildTurns produces three per-pill turns mirroring suggestions.ts", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-agent",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.input).toContain("Plan a product launch");
    expect(turns[1]!.input).toContain("team offsite");
    expect(turns[2]!.input).toContain("top competitor");
  });

  it("each turn carries a preFill baseline-capture hook", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-agent",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    for (const turn of turns) {
      expect(typeof turn.preFill).toBe("function");
      expect(typeof turn.assertions).toBe("function");
    }
  });

  it("GEN_UI_AGENT_PILLS lists three tags", () => {
    const tags = GEN_UI_AGENT_PILLS.map((p) => p.tag);
    expect(tags).toEqual([
      "product-launch",
      "team-offsite",
      "competitor-research",
    ]);
  });

  it("baseline-capture writes the current step state into the ref", async () => {
    const ref = newBaseline();
    const capture = buildBaselineCapture(ref);
    const page = makePage({ stepCount: 4, stepText: "leftover rows" });
    await capture(page);
    expect(ref.captured).toBe(true);
    expect(ref.stepCount).toBe(4);
    expect(ref.stepText).toBe("leftover rows");
  });

  it("assertion succeeds when ≥ 2 NEW rows render past baseline", async () => {
    const seen = { values: [] as string[] };
    // Pre-pill baseline has 0 rows; pill produces 3 → delta = 3.
    const baseline = newCapturedBaseline({ stepCount: 0, stepText: "" });
    const assertion = buildAgentStateAssertion(
      "product-launch",
      baseline,
      seen,
    );
    const page = makePage({
      stepCount: 3,
      stepText: "Define launch goals Coordinate marketing rollout",
    });
    await expect(assertion(page)).resolves.toBeUndefined();
    expect(seen.values).toHaveLength(1);
  });

  it("assertion fails when no NEW rows render (cross-pill leftover)", async () => {
    const seen = { values: [] as string[] };
    // Baseline is 3 rows from a previous pill; final is also 3 → delta = 0.
    const baseline = newCapturedBaseline({
      stepCount: 3,
      stepText: "leftover steps from prior pill",
    });
    const assertion = buildAgentStateAssertion("team-offsite", baseline, seen);
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        // Always return the leftover state — delta stays 0, the
        // 15s deadline fires and surfaces the "expected ≥ 2 NEW"
        // message, proving the leftover guard fires.
        return {
          stepCount: 3,
          stepText: "leftover steps from prior pill",
        } as unknown as R;
      },
    };
    await expect(assertion(page)).rejects.toThrow(/expected ≥ 2 NEW/);
  }, 20_000);

  it("assertion fails when baseline was never captured", async () => {
    const seen = { values: [] as string[] };
    const baseline = newBaseline(); // captured: false
    const assertion = buildAgentStateAssertion(
      "product-launch",
      baseline,
      seen,
    );
    const page = makePage({ stepCount: 5, stepText: "lots of steps" });
    await expect(assertion(page)).rejects.toThrow(/baseline was not captured/);
  });

  it("assertion rejects when evaluate cannot produce settled state", async () => {
    const seen = { values: [] as string[] };
    const baseline = newCapturedBaseline({ stepCount: 0, stepText: "" });
    const assertion = buildAgentStateAssertion(
      "product-launch",
      baseline,
      seen,
    );
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        // Throw after a few polls — the throw propagates out of
        // `readAgentStepState` and aborts the polling loop, so the
        // test exits quickly without waiting for the 15s deadline.
        if (calls > 3) throw new Error("simulated abort");
        return { stepCount: 0, stepText: "" } as unknown as R;
      },
    };
    await expect(assertion(page)).rejects.toThrow();
  });

  it("assertion fails when step content duplicates an earlier pill", async () => {
    const seen = { values: ["shared steps content"] };
    const baseline = newCapturedBaseline({ stepCount: 0, stepText: "" });
    const assertion = buildAgentStateAssertion("team-offsite", baseline, seen);
    const page = makePage({
      stepCount: 3,
      stepText: "shared steps content",
    });
    await expect(assertion(page)).rejects.toThrow(/duplicates/);
  });
});
