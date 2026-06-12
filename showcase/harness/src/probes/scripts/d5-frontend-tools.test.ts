import { describe, it, expect, vi } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildPillAssertion,
  FRONTEND_TOOL_PILLS,
  PILL_GRADIENT_HINTS,
} from "./d5-frontend-tools.js";

/** Build a fake Page that reads its background-css attribute from a
 *  caller-controlled queue. Each `evaluate()` call dequeues the next
 *  scripted value, which lets a single test simulate the
 *  baseline -> changed -> stable cycle. */
function makePage(values: string[]): Page {
  let idx = 0;
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      const v = values[Math.min(idx, values.length - 1)] ?? "";
      idx += 1;
      return v as unknown as R;
    },
  };
}

describe("d5-frontend-tools script", () => {
  it("registers under featureType 'frontend-tools'", () => {
    const script = getD5Script("frontend-tools");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["frontend-tools"]);
    expect(script?.fixtureFile).toBe("frontend-tools.json");
  });

  it("buildTurns produces three per-pill turns matching suggestions.ts", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "frontend-tools",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.input).toBe("Make the background a sunset gradient.");
    expect(turns[1]!.input).toBe("Switch to a deep green forest gradient.");
    expect(turns[2]!.input).toBe("Make it a navy → magenta cosmic gradient.");
  });

  it("FRONTEND_TOOL_PILLS covers sunset / forest / cosmic", () => {
    const tags = FRONTEND_TOOL_PILLS.map((p) => p.tag);
    expect(tags).toEqual(["sunset", "forest", "cosmic"]);
  });

  it("PILL_GRADIENT_HINTS lists per-family color tokens", () => {
    expect(PILL_GRADIENT_HINTS.sunset).toContain("orange");
    expect(PILL_GRADIENT_HINTS.forest).toContain("green");
    expect(PILL_GRADIENT_HINTS.cosmic).toContain("magenta");
  });

  it("assertion succeeds when background changes to a gradient containing the pill's hint", async () => {
    const baseline = { current: "#4f46e5" };
    const assert = buildPillAssertion("sunset", baseline);
    // First read: testid mount waitForSelector (no-op in fake).
    // Second/third read: readBackgroundCss values.
    const page = makePage(["#ff7e5f orange gradient"]);
    await expect(assert(page)).resolves.toBeUndefined();
    expect(baseline.current).toBe("#ff7e5f orange gradient");
  });

  it("assertion fails when background did not change off baseline", async () => {
    // Drive `waitForBackgroundChange`'s polling loop forward with
    // fake timers so the FIRST_SIGNAL_TIMEOUT_MS deadline expires
    // synchronously inside the test instead of taking the real 60s.
    vi.useFakeTimers();
    try {
      const baseline = { current: "#4f46e5" };
      const assert = buildPillAssertion("sunset", baseline);
      // Page always reports the baseline — the assertion should
      // time out and throw a "did not change off baseline" error.
      const page = makePage(["#4f46e5"]);
      const promise = assert(page);
      // Attach the rejection assertion BEFORE advancing timers so
      // unhandled-rejection warnings don't fire while the loop spins.
      const expectation = expect(promise).rejects.toThrow(
        /did not change off baseline/,
      );
      // Fast-forward past the FIRST_SIGNAL_TIMEOUT_MS deadline.
      await vi.advanceTimersByTimeAsync(70_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("assertion fails when background changes to a wrong-family gradient", async () => {
    const baseline = { current: "#4f46e5" };
    const assert = buildPillAssertion("sunset", baseline);
    // Sunset pill but the page reports a green/forest-flavored
    // gradient — should throw a "sunset hint" error.
    const page = makePage(["#0a3d2e green gradient"]);
    await expect(assert(page)).rejects.toThrow(/sunset hint/);
  });

  it("assertion accepts arbitrary green hex codes via channel-dominance fallback (real-LLM nondeterminism)", async () => {
    // Real OpenAI returned `linear-gradient(to right, #005f00, #4caf50)`
    // for the forest pill — perfectly valid green, but neither the
    // word `green` nor any of the fixture-pinned hex codes
    // (`#0a3d2e`/`#166534`/`#059669`) appears as a substring. The
    // channel-dominance fallback parses the hex codes and accepts
    // them because each one has G > R AND G > B. Without the
    // fallback this assertion would throw.
    const baseline = { current: "#4f46e5" };
    const assert = buildPillAssertion("forest", baseline);
    const page = makePage(["linear-gradient(to right, #005f00, #4caf50)"]);
    await expect(assert(page)).resolves.toBeUndefined();
  });

  it("assertion still rejects a gradient with no on-family hex AND no on-family word", async () => {
    // Forest pill, but page emitted only sunset-family hex codes.
    // Word match misses (no green/forest etc.) AND channel-dominance
    // misses (R-dominant, not G-dominant). Must throw.
    const baseline = { current: "#4f46e5" };
    const assert = buildPillAssertion("forest", baseline);
    const page = makePage(["linear-gradient(to right, #ff7e5f, #ff6b6b)"]);
    await expect(assert(page)).rejects.toThrow(/forest hint/);
  });
});
