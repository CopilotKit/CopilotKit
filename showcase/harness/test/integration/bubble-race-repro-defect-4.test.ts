import { describe, it, expect } from "vitest";
import { runBubbleRaceRepro } from "./bubble-race-repro.js";

describe("bubble-race repro (defect 4: boot-time baseline staleness)", () => {
  it("first turn completes within 30s when a pre-paint placeholder is present", async () => {
    const start = Date.now();
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:agentic-chat",
      level: "d5",
      messages: ["good name for a goldfish"],
      prePaint:
        '<div role="article" data-bubble-race-placeholder>placeholder</div>',
    });
    const elapsedMs = Date.now() - start;
    expect(result.exitCode).toBe(0);
    // Defect manifests as a 30s+ settle-timeout. Assertion is on
    // observable wall-clock + first-turn text — NOT on internal log
    // strings or internal exception types unique to the old
    // implementation (the test must survive the deletion of
    // `waitForAssistantSettled` in Phase 5).
    expect(elapsedMs).toBeLessThan(30_000);
    expect(result.turns[0].assistantTextLength).toBeGreaterThan(0);
  }, 90_000);
});
