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

  it("assertion clicks slot via evaluate (JS-level click) then waits for picked state", async () => {
    // The probe now uses `clickByJs` (page.evaluate-driven .click()) to
    // bypass the cpk-web-inspector overlay. Assert the evaluate call
    // fires with a function whose body contains the slot selector,
    // followed by waitForSelector for the picked-state testid.
    const evaluate = vi.fn<(fn: () => unknown) => Promise<unknown>>(
      async () => undefined,
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
    // selector via JSON.stringify. The first evaluate call is the click;
    // assert the function body references the slot selector.
    expect(evaluate).toHaveBeenCalled();
    const firstCall = evaluate.mock.calls[0];
    expect(firstCall).toBeDefined();
    const clickFn = firstCall![0];
    expect(typeof clickFn).toBe("function");
    expect(clickFn.toString()).toContain("time-picker-slot");
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="time-picker-picked"]',
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
