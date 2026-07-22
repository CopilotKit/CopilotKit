import { describe, it, expect } from "vitest";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import { getD5Script } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildAgentStateAssertion,
  GEN_UI_AGENT_PILLS,
} from "./d5-gen-ui-agent.js";

/**
 * DYNAMIC fake: `evaluate()` returns a DIFFERENT set of step rows on
 * each successive poll, driven by `frames`. This forces the probe's
 * swap-window wait loop to actually iterate (the poll path executes)
 * rather than being satisfied by a single static read. The last frame
 * repeats forever so the loop settles on it.
 *
 * The probe reads step rows via a `querySelectorAll('[data-testid=
 * "agent-step"]')` inside `page.evaluate`; our fake ignores the passed
 * function and returns the current frame's rows directly, which is how
 * the runner's structural `Page.evaluate` fake contract works.
 */
function makeDynamicPage(frames: string[][]): {
  page: Page;
  pollCount: () => number;
} {
  let idx = 0;
  const page: Page = {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      const frame = frames[Math.min(idx, frames.length - 1)]!;
      idx += 1;
      return frame as unknown as R;
    },
  };
  return { page, pollCount: () => idx };
}

/** Static single-frame fake (still exercises one poll iteration). */
function makePage(rows: string[]): Page {
  return makeDynamicPage([rows]).page;
}

describe("d5-gen-ui-agent script", () => {
  it("registers under featureType 'gen-ui-agent'", () => {
    const script = getD5Script("gen-ui-agent");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-agent.json");
  });

  it("buildTurns produces three per-pill turns mirroring the demo pills", () => {
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
    expect(turns.map((turn) => turn.completeOnMount)).toEqual([
      { testIds: ["agent-state-card"], minNewMounts: 0 },
      { testIds: ["agent-state-card"], minNewMounts: 0 },
      { testIds: ["agent-state-card"], minNewMounts: 0 },
    ]);
  });

  it("GEN_UI_AGENT_PILLS lists three tags with expected markers", () => {
    const tags = GEN_UI_AGENT_PILLS.map((p) => p.tag);
    expect(tags).toEqual([
      "product-launch",
      "team-offsite",
      "competitor-research",
    ]);
    // Markers are derived from the fixture step titles.
    expect(GEN_UI_AGENT_PILLS[0]!.expectedMarkers).toEqual([
      "launch",
      "marketing",
    ]);
    expect(GEN_UI_AGENT_PILLS[1]!.expectedMarkers).toEqual(["venue", "agenda"]);
    expect(GEN_UI_AGENT_PILLS[2]!.expectedMarkers).toEqual([
      "competitor",
      "weakness",
    ]);
  });

  it("GREEN: accepts once the correct pill content lands across the swap window (poll path runs)", async () => {
    const seen = { values: [] as string[] };
    const assertion = buildAgentStateAssertion(
      "product-launch",
      ["launch", "marketing"],
      seen,
    );
    // Frame 0: swap not landed — no rows yet.
    // Frame 1: still swapping — previous (empty) placeholder.
    // Frame 2+: product-launch content lands.
    const { page, pollCount } = makeDynamicPage([
      [],
      [""],
      [
        "Define launch goals and audience",
        "Coordinate marketing and PR rollout",
        "Track post-launch metrics for week 1",
      ],
    ]);
    await expect(assertion(page)).resolves.toBeUndefined();
    // Prove the poll/wait loop actually iterated (≥ 3 reads).
    expect(pollCount()).toBeGreaterThanOrEqual(3);
    expect(seen.values).toHaveLength(1);
    expect(seen.values[0]).toContain("launch");
    expect(seen.values[0]).toContain("marketing");
  }, 20_000);

  it("GREEN: distinct-per-pill content passes for all three pills in sequence", async () => {
    const seen = { values: [] as string[] };
    const a1 = buildAgentStateAssertion(
      "product-launch",
      ["launch", "marketing"],
      seen,
    );
    await expect(
      a1(
        makePage([
          "Define launch goals and audience",
          "Coordinate marketing and PR rollout",
        ]),
      ),
    ).resolves.toBeUndefined();

    const a2 = buildAgentStateAssertion(
      "team-offsite",
      ["venue", "agenda"],
      seen,
    );
    await expect(
      a2(
        makePage([
          "Reserve venue near downtown for 30 engineers",
          "Build day-by-day agenda with workshop slots",
        ]),
      ),
    ).resolves.toBeUndefined();

    const a3 = buildAgentStateAssertion(
      "competitor-research",
      ["competitor", "weakness"],
      seen,
    );
    await expect(
      a3(
        makePage([
          "Map competitor product surface and pricing tiers",
          "Identify weaknesses our positioning can exploit",
        ]),
      ),
    ).resolves.toBeUndefined();

    expect(seen.values).toHaveLength(3);
  }, 30_000);

  it("RED / FALSE-GREEN GUARD: fails on same canned steps for every pill (identical content across pills)", async () => {
    // Regression: backend returns the SAME product-launch steps for
    // EVERY pill. Pill 1 (product-launch) passes, but pill 2
    // (team-offsite) renders launch content → wrong markers → RED.
    const seen = { values: [] as string[] };
    const canned = [
      "Define launch goals and audience",
      "Coordinate marketing and PR rollout",
      "Track post-launch metrics for week 1",
    ];
    const a1 = buildAgentStateAssertion(
      "product-launch",
      ["launch", "marketing"],
      seen,
    );
    await expect(a1(makePage(canned))).resolves.toBeUndefined();

    const a2 = buildAgentStateAssertion(
      "team-offsite",
      ["venue", "agenda"],
      seen,
    );
    // Dynamic fake: repeatedly returns the stale canned content — poll
    // loop runs to the deadline, then hard-fails on missing markers.
    const { page, pollCount } = makeDynamicPage([canned]);
    await expect(a2(page)).rejects.toThrow(
      /missing expected marker\(s\) \[venue, agenda\]/,
    );
    expect(pollCount()).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("RED / FALSE-GREEN GUARD: fails on stale NON-ADJACENT content (pill 3 shows pill 1's content)", async () => {
    const seen = { values: [] as string[] };
    const pill1 = [
      "Define launch goals and audience",
      "Coordinate marketing and PR rollout",
    ];
    const pill2 = [
      "Reserve venue near downtown for 30 engineers",
      "Build day-by-day agenda with workshop slots",
    ];
    const a1 = buildAgentStateAssertion(
      "product-launch",
      ["launch", "marketing"],
      seen,
    );
    await expect(a1(makePage(pill1))).resolves.toBeUndefined();
    const a2 = buildAgentStateAssertion(
      "team-offsite",
      ["venue", "agenda"],
      seen,
    );
    await expect(a2(makePage(pill2))).resolves.toBeUndefined();

    // Pill 3 (competitor-research) stale-renders PILL 1's content
    // (non-adjacent). Adjacency-only dedup would miss this; content
    // markers catch it → RED.
    const a3 = buildAgentStateAssertion(
      "competitor-research",
      ["competitor", "weakness"],
      seen,
    );
    const { page } = makeDynamicPage([pill1]);
    await expect(a3(page)).rejects.toThrow(
      /missing expected marker\(s\) \[competitor, weakness\]/,
    );
  }, 30_000);

  it("RED / FALSE-GREEN GUARD: fails on empty/whitespace step rows (stepCount ≥ 2 but rows are blank)", async () => {
    const seen = { values: [] as string[] };
    const assertion = buildAgentStateAssertion(
      "product-launch",
      ["launch", "marketing"],
      seen,
    );
    // Three rows present in the DOM, but all trim to empty — a card that
    // rendered blank placeholder rows must NOT count toward ≥ 2.
    // (readAgentStepRows trims inside page.evaluate; the fake bypasses
    // that, so we supply the already-trimmed values the real DOM read
    // would return: whitespace-only rows collapse to "".)
    const { page, pollCount } = makeDynamicPage([["", "", ""]]);
    await expect(assertion(page)).rejects.toThrow(
      /expected ≥ 2 non-empty \[data-testid="agent-step"\] rows/,
    );
    expect(pollCount()).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("RED / FALSE-GREEN GUARD: fails when fewer than 2 rows render at all", async () => {
    const seen = { values: [] as string[] };
    const assertion = buildAgentStateAssertion(
      "team-offsite",
      ["venue", "agenda"],
      seen,
    );
    const { page } = makeDynamicPage([["Reserve venue near downtown"]]);
    await expect(assertion(page)).rejects.toThrow(
      /expected ≥ 2 non-empty \[data-testid="agent-step"\] rows/,
    );
  }, 30_000);
});
