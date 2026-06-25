import { describe, it, expect } from "vitest";
import { runBubbleRaceRepro } from "./bubble-race-repro.js";

describe("bubble-race repro (defect 1: settle-on-count-not-text)", () => {
  it("reads non-empty text from the assistant bubble on fast SSE replay", async () => {
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:agentic-chat",
      level: "d5",
      messages: ["good name for a goldfish"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.turns).toHaveLength(1);
    // The defect manifests as the runner reading the empty wrapper or a
    // partial-stream prefix (e.g. "I" or "Th") that satisfies a naive
    // /[A-Za-z]/ regex while STILL representing the very settle-on-count-
    // not-text bug we're guarding against. Two layered assertions pin
    // the canonical, fully-streamed response:
    //   (a) non-trivial length (the empty wrapper or 1-2 char prefix
    //       both fail this) — defends against the partial-prefix case
    //       that motivated this strengthening.
    //   (b) presence of "Bubbles" — the canonical fixture token for
    //       "good name for a goldfish" (see aimock/d6/langgraph-python/
    //       agentic-chat.json; same token defect-2 turn-1 asserts on).
    expect(result.turns[0].assistantText.trim().length).toBeGreaterThanOrEqual(
      10,
    );
    expect(result.turns[0].assistantText).toContain("Bubbles");
  }, 120_000);
});
