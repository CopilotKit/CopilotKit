import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildBaselineCapture,
  buildStreamingAssertion,
  SHARED_STATE_STREAMING_PILLS,
  STREAMING_MIN_FINAL_CHARS,
  type StreamingBaselineRef,
} from "./d5-shared-state-streaming.js";

function makePage(state: {
  charCount: number;
  text?: string;
  liveBadgePresent: boolean;
}): Page {
  const filled = { text: "", ...state };
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return filled as unknown as R;
    },
  };
}

function newRef(): StreamingBaselineRef {
  return { charCount: 0, text: "", captured: false };
}

describe("d5-shared-state-streaming script", () => {
  it("registers under featureType 'shared-state-streaming'", () => {
    const script = getD5Script("shared-state-streaming");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("shared-state-streaming.json");
  });

  it("buildTurns produces three per-pill turns mirroring suggestions.ts", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "shared-state-streaming",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.input).toContain("poem about autumn leaves");
    expect(turns[1]!.input).toContain("declining a meeting");
    expect(turns[2]!.input).toContain("quantum computing");
  });

  it("each turn carries a preFill baseline-capture hook", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "shared-state-streaming",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    for (const turn of turns) {
      expect(typeof turn.preFill).toBe("function");
      expect(typeof turn.assertions).toBe("function");
    }
  });

  it("SHARED_STATE_STREAMING_PILLS lists three tags", () => {
    expect(SHARED_STATE_STREAMING_PILLS.map((p) => p.tag)).toEqual([
      "autumn-poem",
      "decline-email",
      "quantum-explainer",
    ]);
  });

  it("baseline-capture writes the current doc state into the ref", async () => {
    const ref = newRef();
    const capture = buildBaselineCapture(ref);
    const page = makePage({
      charCount: 42,
      text: "leftover from previous pill",
      liveBadgePresent: false,
    });
    await capture(page);
    expect(ref.captured).toBe(true);
    expect(ref.charCount).toBe(42);
    expect(ref.text).toBe("leftover from previous pill");
  });

  it("assertion succeeds when delta from baseline meets the threshold", async () => {
    const ref: StreamingBaselineRef = {
      charCount: 100,
      text: "old",
      captured: true,
    };
    const assertion = buildStreamingAssertion("autumn-poem", ref);
    const page = makePage({
      charCount: 100 + STREAMING_MIN_FINAL_CHARS + 5,
      text: "old plus a substantively longer poem about autumn leaves",
      liveBadgePresent: false,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion succeeds when text replaced and final ≥ threshold", async () => {
    const ref: StreamingBaselineRef = {
      charCount: 200,
      text: "previous pill output that is somewhat long",
      captured: true,
    };
    const assertion = buildStreamingAssertion("decline-email", ref);
    const page = makePage({
      charCount: STREAMING_MIN_FINAL_CHARS + 5,
      // Different text — the document was REPLACED, not appended to.
      text: "completely different decline-email content here, fresh from the agent",
      liveBadgePresent: false,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when no new content was produced (leftover only)", async () => {
    const ref: StreamingBaselineRef = {
      charCount: 100,
      text: "leftover content from previous pill",
      captured: true,
    };
    const assertion = buildStreamingAssertion("autumn-poem", ref);
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        // Return the SAME state as the baseline — no new content,
        // assertion should fail via the deadline path despite the
        // absolute char count being above the legacy threshold.
        return {
          charCount: 100,
          text: "leftover content from previous pill",
          liveBadgePresent: false,
        } as unknown as R;
      },
    };
    // The polling loop exhausts the 5s internal deadline; the test
    // timeout is bumped accordingly. The error message proves the
    // failure mode is "no substantive change" rather than a generic
    // timeout, validating the leftover-only guard.
    await expect(assertion(page)).rejects.toThrow(
      /did not change substantively/,
    );
  }, 10_000);

  it("assertion fails when baseline was never captured", async () => {
    const ref = newRef(); // captured: false
    const assertion = buildStreamingAssertion("autumn-poem", ref);
    const page = makePage({
      charCount: 1000,
      text: "lots of content",
      liveBadgePresent: false,
    });
    await expect(assertion(page)).rejects.toThrow(/baseline was not captured/);
  });
});
