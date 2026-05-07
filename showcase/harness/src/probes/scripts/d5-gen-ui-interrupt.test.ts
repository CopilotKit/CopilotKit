import { describe, it, expect, vi } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
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

  it("assertion clicks slot then waits for picked state", async () => {
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForSelector = vi.fn().mockResolvedValue(undefined);
    const page = {
      waitForSelector,
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
      click,
    } as unknown as Page;
    const assertion = buildInterruptAssertion("sales-call");
    await expect(assertion(page)).resolves.toBeUndefined();
    expect(click).toHaveBeenCalledWith(
      '[data-testid="time-picker-slot"]',
      expect.any(Object),
    );
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
      async click() {},
    } as unknown as Page;
    const assertion = buildInterruptAssertion("sales-call");
    await expect(assertion(page)).rejects.toThrow(/time-picker-card.*mount/);
  });

  it("assertion fails when page is missing click()", async () => {
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    const assertion = buildInterruptAssertion("sales-call");
    await expect(assertion(page)).rejects.toThrow(/missing click/);
  });
});
