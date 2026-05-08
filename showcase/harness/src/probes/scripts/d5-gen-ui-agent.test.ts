import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildAgentStateAssertion,
  GEN_UI_AGENT_PILLS,
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

  it("GEN_UI_AGENT_PILLS lists three tags", () => {
    const tags = GEN_UI_AGENT_PILLS.map((p) => p.tag);
    expect(tags).toEqual([
      "product-launch",
      "team-offsite",
      "competitor-research",
    ]);
  });

  it("assertion succeeds when ≥ 2 step rows render with novel content", async () => {
    const seen = { values: [] as string[] };
    const assertion = buildAgentStateAssertion("product-launch", seen);
    const page = makePage({
      stepCount: 3,
      stepText: "Define launch goals Coordinate marketing rollout",
    });
    await expect(assertion(page)).resolves.toBeUndefined();
    expect(seen.values).toHaveLength(1);
  });

  it("assertion succeeds across pills under last-write-wins state swap", async () => {
    // First pill establishes a fingerprint; second pill swaps state
    // (DOM still has 3 rows, but the textContent reflects the NEW
    // pill's steps), assertion accepts because content differs from
    // the seen-set.
    const seen = { values: [] as string[] };
    const firstAssertion = buildAgentStateAssertion("product-launch", seen);
    const firstPage = makePage({
      stepCount: 3,
      stepText: "launch goals marketing rollout post-launch metrics",
    });
    await expect(firstAssertion(firstPage)).resolves.toBeUndefined();

    const secondAssertion = buildAgentStateAssertion("team-offsite", seen);
    const secondPage = makePage({
      stepCount: 3,
      stepText: "venue agenda travel",
    });
    await expect(secondAssertion(secondPage)).resolves.toBeUndefined();
    expect(seen.values).toHaveLength(2);
  });

  it("assertion fails when fewer than 2 rows render in 15s", async () => {
    const seen = { values: [] as string[] };
    const assertion = buildAgentStateAssertion("team-offsite", seen);
    const page = makePage({ stepCount: 1, stepText: "only one step" });
    await expect(assertion(page)).rejects.toThrow(
      /expected ≥ 2 \[data-testid="agent-step"\] rows/,
    );
  }, 20_000);

  it("assertion fails when step content duplicates an earlier pill", async () => {
    const seen = { values: ["shared steps content"] };
    const assertion = buildAgentStateAssertion("team-offsite", seen);
    const page = makePage({
      stepCount: 3,
      stepText: "shared steps content",
    });
    await expect(assertion(page)).rejects.toThrow(/duplicates/);
  }, 20_000);
});
