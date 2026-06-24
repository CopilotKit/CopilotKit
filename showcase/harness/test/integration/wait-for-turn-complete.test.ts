/**
 * Mechanism-GREEN tests for the `waitForTurnComplete` 3-conjunct primitive.
 *
 * This primitive composes three independent readiness signals into one
 * settle gate for a single turn:
 *
 *   1. SSE       — `window.__hk_runsFinished >= turnIndex` (s7 counter)
 *   2. DOM       — bubble at strict index `turnIndex - 1` exists under
 *                  the shared cascade (s5/s6 helper)
 *   3. TEXT      — that bubble's textContent is non-empty AND stable
 *                  across `settleMs` of consecutive polls
 *
 * We don't need a real Playwright Page here — we hand the primitive a
 * structural fake whose `evaluate()` dispatches on the function body
 * (the SSE read references `__hk_runsFinished`, the atomic cascade read
 * uses `querySelectorAll` + `textContent` + the literal `{ count`
 * substring the closure uses to construct its return object). That keeps
 * each case deterministic + millisecond-cheap, while still exercising the
 * EXACT runtime code path of the primitive (same dispatch the production
 * helpers make).
 *
 * Post-r4f2 (commit 6a98baef1) the runner uses `readCascadeState` which
 * returns `{ count, text }` atomically in a single `page.evaluate` — so
 * each poll makes TWO evaluates (SSE counter + atomic cascade state),
 * not three (previously SSE + count + text).
 */
import { describe, it, expect } from "vitest";
import {
  waitForTurnComplete,
  TurnNotCompleteError,
} from "../../src/probes/helpers/conversation-runner.js";

interface ScriptStep {
  runsFinished: number;
  count: number;
  text: string | null;
}

/**
 * Build a structural Page double whose successive `evaluate()` calls
 * return values from a pre-baked script. Each script step represents
 * "the state of the world the next time the primitive looks at it" —
 * so a single step is consumed by the two reads the primitive makes
 * per iteration (sse + atomic cascade state). We collapse those two
 * into one step by branching on the function body.
 *
 * The dispatch heuristic:
 *   - body mentions `__hk_runsFinished` -> SSE read; return runsFinished
 *   - body mentions `querySelectorAll` AND `textContent` AND `{ count`
 *     -> atomic `readCascadeState` read; return `{ count, text }`
 *     mirroring the production helper's return shape (see
 *     `assistant-message-count.ts:readCascadeState`).
 *   - body mentions `querySelectorAll` but NOT `textContent` and NOT
 *     `{ count` -> `countAssistantMessages` (the final-classification
 *     count-only re-read after timeout); return `step.count`.
 *
 * We do NOT advance the script on every evaluate — we advance once per
 * "tick" (2 evaluates: sse + cascade state). That keeps the script
 * 1:1 with poll iterations during the in-loop polling phase.
 *
 * Final-classification reads (`readRunsFinished` + `countAssistantMessages`
 * after the timeout) drain from the frozen last script step, which mirrors
 * "steady state at the deadline".
 *
 * Why `{ count` as the discriminator: the production `readCascadeState`
 * closure body contains both `querySelectorAll` and `textContent`, AND
 * the literal substring `{ count` (it constructs `{ count, text }`
 * objects to return). The unit-test fakes in `conversation-runner.test.ts`
 * use the same `{ count` substring to route the call to the atomic
 * cascade branch — we mirror that pattern here.
 */
function makeScriptedPage(script: ScriptStep[]) {
  let tickIdx = 0;
  const currentStep = (): ScriptStep =>
    script[Math.min(tickIdx, script.length - 1)];
  return {
    async evaluate(fn: unknown, arg?: unknown): Promise<unknown> {
      const body = String(fn);
      const step = currentStep();
      if (body.includes("__hk_runsFinished")) return step.runsFinished;
      // CopilotKit v2 run-lifecycle summary (`__hk_copilotRunning`) — the
      // PRIMARY done-signal. These mechanism scripts model the legacy
      // SSE-counter world (no chat-view attribute), so return the
      // "attribute absent" shape; the gate falls back to the SSE counter,
      // preserving the exact pre-fix conjunct semantics these tests assert.
      if (body.includes("__hk_copilotRunning")) {
        return {
          attrPresent: false,
          runningNow: null,
          sawRunningTrue: false,
          runStartCount: 0,
          lastStoppedAtMs: 0,
        };
      }
      // Atomic cascade-state read (`readCascadeState`): returns BOTH the
      // count and the indexed text from the SAME cascade tier in ONE
      // round-trip. The distinguishing substring is the literal `{ count`
      // that the production closure uses to construct its return object —
      // same dispatch pattern as `conversation-runner.test.ts`'s fake.
      if (
        body.includes("querySelectorAll") &&
        body.includes("textContent") &&
        body.includes("{ count")
      ) {
        // The atomic cascade read is the once-per-poll anchor — advance the
        // script tick HERE (rather than counting raw evaluates) so the
        // script stays 1:1 with poll iterations regardless of how many
        // auxiliary reads (`__hk_runsFinished`, `__hk_copilotRunning`) the
        // primitive makes per poll. This is robust to the done-signal
        // overhaul adding a third per-poll read.
        const idx = (arg as number | undefined) ?? 0;
        const result =
          idx < 0 || idx >= step.count
            ? { count: step.count, text: null }
            : // Only index 0 has populated text in our scripts; mirror the
              // null-when-out-of-range behaviour of the production cascade.
              { count: step.count, text: idx === 0 ? step.text : null };
        tickIdx += 1;
        return result;
      }
      // Count-only re-read (`countAssistantMessages`): used by the
      // final-classification path AFTER the polling loop times out.
      // The closure body iterates cascade tiers and returns the first
      // tier's `.length` — `querySelectorAll` present, `textContent`
      // absent, `{ count` absent. Mirror the cascade by returning the
      // current step's count.
      if (body.includes("querySelectorAll")) {
        return step.count;
      }
      return 0;
    },
  } as unknown as Parameters<typeof waitForTurnComplete>[0]["page"];
}

describe("waitForTurnComplete (mechanism-GREEN)", () => {
  it("happy path — returns once SSE + DOM + stable text all hold", async () => {
    // Steady state from step 0: SSE=1, count=1, text="hello" for long enough
    // that the stable-text window of 50ms elapses across multiple polls.
    const steady: ScriptStep = {
      runsFinished: 1,
      count: 1,
      text: "hello",
    };
    const page = makeScriptedPage([
      { runsFinished: 0, count: 0, text: null },
      steady,
      steady,
      steady,
      steady,
      steady,
      steady,
      steady,
      steady,
    ]);
    const result = await waitForTurnComplete({
      page,
      turnIndex: 1,
      settleMs: 50,
      timeoutMs: 5_000,
      pollIntervalMs: 20,
    });
    expect(result.bubbleIndex).toBe(0);
    expect(result.text).toBe("hello");
  });

  it("sse-missing — throws TurnNotCompleteError with reason 'sse-missing' when RUN_FINISHED never arrives", async () => {
    // DOM + text are ready immediately, but the SSE counter NEVER ticks
    // to 1. We expect the primitive to time out and classify the cause
    // as sse-missing (runsFinished < turnIndex at the final read).
    const page = makeScriptedPage([
      { runsFinished: 0, count: 1, text: "premature" },
    ]);
    let caught: unknown = null;
    try {
      await waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 20,
        timeoutMs: 300,
        pollIntervalMs: 20,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TurnNotCompleteError);
    expect((caught as TurnNotCompleteError).reason).toBe("sse-missing");
    expect((caught as TurnNotCompleteError).turnIndex).toBe(1);
  });

  it("dom-missing — throws TurnNotCompleteError with reason 'dom-missing' when bubble at index never appears", async () => {
    // SSE counter ticks to 1, but the cascade never finds any bubble.
    // Final-classification preference order is sse-missing > dom-missing
    // > text-unstable, so with sse>=turnIndex at the final read this must
    // surface as dom-missing.
    const page = makeScriptedPage([{ runsFinished: 1, count: 0, text: null }]);
    let caught: unknown = null;
    try {
      await waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 20,
        timeoutMs: 300,
        pollIntervalMs: 20,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TurnNotCompleteError);
    expect((caught as TurnNotCompleteError).reason).toBe("dom-missing");
    expect((caught as TurnNotCompleteError).turnIndex).toBe(1);
  });

  it("text-unstable — throws TurnNotCompleteError with reason 'text-unstable' when text never settles", async () => {
    // SSE counter ticks to 1, cascade returns count=1 throughout, but the
    // bubble's text keeps changing on every poll — settle window never
    // closes. With sse>=turnIndex and count>bubbleIndex at the final
    // read, the classification falls through to text-unstable.
    const flapping: ScriptStep[] = [];
    for (let i = 0; i < 50; i += 1) {
      flapping.push({
        runsFinished: 1,
        count: 1,
        text: `chunk-${i}`,
      });
    }
    const page = makeScriptedPage(flapping);
    let caught: unknown = null;
    try {
      await waitForTurnComplete({
        page,
        turnIndex: 1,
        settleMs: 200,
        timeoutMs: 300,
        pollIntervalMs: 20,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TurnNotCompleteError);
    expect((caught as TurnNotCompleteError).reason).toBe("text-unstable");
    expect((caught as TurnNotCompleteError).turnIndex).toBe(1);
  });
});
