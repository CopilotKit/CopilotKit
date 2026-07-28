import { describe, it, expect, vi } from "vitest";
import { getD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildInterruptAssertion,
  GEN_UI_INTERRUPT_PILLS,
} from "./d5-gen-ui-interrupt.js";

describe("d5-gen-ui-interrupt script", () => {
  it("registers under featureType 'gen-ui-interrupt'", () => {
    const script = getD5Script("gen-ui-interrupt");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-interrupt.json");
  });

  it("buildTurns produces two per-pill turns mirroring suggestions.ts", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-interrupt",
      baseUrl: "https://x.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.input).toContain("intro call with the sales team");
    expect(turns[1]!.input).toContain("1:1 with Alice");
  });

  it("GEN_UI_INTERRUPT_PILLS lists two pill tags", () => {
    expect(GEN_UI_INTERRUPT_PILLS.map((p) => p.tag)).toEqual([
      "sales-call",
      "alice-1on1",
    ]);
  });

  it("assertion clicks via JS then waits for a new resumed-run confirmation", async () => {
    // The probe uses `clickByJs` (page.evaluate-driven .click()) to
    // bypass the cpk-web-inspector overlay, then requires the assistant
    // cascade to grow with a booked/scheduled confirmation. The card's
    // synchronous local picked state alone must not advance pill 2 while
    // pill 1 is still returning its tool result.
    //
    // Test mock: first evaluate snapshots the pre-click assistant count,
    // second performs the click, and third observes the new continuation.
    let evaluateCallCount = 0;
    const evaluate = vi.fn<(fn: () => unknown) => Promise<unknown>>(
      async () => {
        evaluateCallCount += 1;
        if (evaluateCallCount === 1) {
          return {
            count: 1,
            lastText: "choose a time",
            pickedTestid: false,
            runningNow: false,
            runStartCount: 1,
            lastStoppedAtMs: Date.now() - 2_000,
            runsFinished: 1,
            sample: "",
          };
        }
        if (evaluateCallCount === 2) return undefined; // click
        return {
          count: 2,
          lastText: "booked: sales intro call confirmed",
          pickedTestid: true,
          runningNow: false,
          runStartCount: 2,
          lastStoppedAtMs: Date.now() - 1_000,
          runsFinished: 2,
          sample: "",
        };
      },
    );
    const waitForSelector = vi.fn().mockResolvedValue(undefined);
    const page = {
      waitForSelector,
      async fill() {},
      async press() {},
      evaluate,
    } as unknown as Page;
    const assertion = buildInterruptAssertion("sales-call");
    await expect(assertion(page)).resolves.toBeUndefined();
    // clickByJs builds a zero-arg function whose source contains the
    // selector via JSON.stringify. Find that call among the baseline/poll
    // evaluates and assert it references the slot selector.
    expect(evaluate).toHaveBeenCalled();
    const clickFn = evaluate.mock.calls
      .map(([fn]) => fn)
      .find((fn) => fn.toString().includes("time-picker-slot"));
    expect(clickFn).toBeDefined();
    expect(typeof clickFn).toBe("function");
    expect(clickFn?.toString()).toContain("time-picker-slot");
    // The probe waits on the time-picker-card AND the time-picker-slot
    // testids before clicking; both should have been waitForSelector'd.
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="time-picker-card"]',
      expect.objectContaining({ state: "visible" }),
    );
  });

  it("assertion fails when time-picker-card never mounts", async () => {
    let calls = 0;
    const page = {
      async waitForSelector() {
        calls += 1;
        if (calls === 1) throw new Error("timeout");
      },
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    } as unknown as Page;
    const assertion = buildInterruptAssertion("sales-call");
    await expect(assertion(page)).rejects.toThrow(/time-picker-card.*mount/);
  });
});
