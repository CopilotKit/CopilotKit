import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildAsyncToolsAssertion,
  ASYNC_PILL_PROMPT,
} from "./d5-frontend-tools-async.js";

function makePage(state: {
  cardMounted: boolean;
  hasListItems: boolean;
  hasEmptyState: boolean;
}): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return state as unknown as R;
    },
  };
}

describe("d5-frontend-tools-async script", () => {
  it("registers under featureType 'frontend-tools-async'", () => {
    const script = getD5Script("frontend-tools-async");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["frontend-tools-async"]);
    expect(script?.fixtureFile).toBe("frontend-tools-async.json");
  });

  it("buildTurns sends the project-planning pill prompt with extended timeout", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "frontend-tools-async",
      baseUrl: "https://x.test",
    };
    const turn = buildTurns(ctx)[0]!;
    expect(turn.input).toBe(ASYNC_PILL_PROMPT);
    expect(turn.responseTimeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("assertion succeeds when notes-card mounts with list items", async () => {
    const assertion = buildAsyncToolsAssertion({ timeoutMs: 100 });
    const page = makePage({
      cardMounted: true,
      hasListItems: true,
      hasEmptyState: false,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion succeeds when notes-card shows empty-state", async () => {
    const assertion = buildAsyncToolsAssertion({ timeoutMs: 100 });
    const page = makePage({
      cardMounted: true,
      hasListItems: false,
      hasEmptyState: true,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when notes-card mounts but never settles", async () => {
    const assertion = buildAsyncToolsAssertion({ timeoutMs: 100 });
    let calls = 0;
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        calls += 1;
        // After a few polls, throw to force the assertion's settle
        // loop to bail out — testing the structural failure path
        // without paying the full FIRST_SIGNAL_TIMEOUT_MS budget.
        if (calls > 3) throw new Error("simulated abort");
        return {
          cardMounted: true,
          hasListItems: false,
          hasEmptyState: false,
        } as unknown as R;
      },
    };
    await expect(assertion(page)).rejects.toThrow();
  });
});
