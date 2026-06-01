import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildContextAssertion,
  preNavigateRoute,
  CONTEXT_NAME_SENTINEL,
  READONLY_PILL_PROMPT,
} from "./d5-readonly-state-context.js";

describe("d5-readonly-state-context script", () => {
  it("registers under featureType 'readonly-state-context'", () => {
    const script = getD5Script("readonly-state-context");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("readonly-state-context.json");
  });

  it("preNavigateRoute resolves /demos/readonly-state-agent-context", () => {
    expect(preNavigateRoute("readonly-state-context")).toBe(
      "/demos/readonly-state-agent-context",
    );
  });

  it("buildTurns sends the pill prompt with extended timeout and a preFill hook", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "readonly-state-context",
      baseUrl: "https://x.test",
    };
    const turn = buildTurns(ctx)[0]!;
    expect(turn.input).toBe(READONLY_PILL_PROMPT);
    expect(turn.responseTimeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(turn.preFill).toBeDefined();
  });

  it("CONTEXT_NAME_SENTINEL is non-trivial and unlikely to collide", () => {
    expect(CONTEXT_NAME_SENTINEL.length).toBeGreaterThanOrEqual(8);
    expect(CONTEXT_NAME_SENTINEL).toMatch(/[A-Z]/);
  });

  it("assertion succeeds when captured body contains the sentinel", async () => {
    const capture = {
      getLastBody: () =>
        '{"messages":[{"role":"user","content":"hi"}],"context":[{"value":"' +
        CONTEXT_NAME_SENTINEL +
        '"}]}',
    };
    const assertion = buildContextAssertion(
      "test",
      capture,
      CONTEXT_NAME_SENTINEL,
    );
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when no request body has been captured", async () => {
    const capture = { getLastBody: () => null };
    const assertion = buildContextAssertion(
      "test",
      capture,
      CONTEXT_NAME_SENTINEL,
    );
    // Use a tiny effective deadline by mocking a fast loop. The
    // assertion polls forever otherwise; we accept a slow test here
    // by allowing it to time out at FIRST_SIGNAL_TIMEOUT_MS — but the
    // test framework default vitest timeout would also expire. So we
    // reduce: directly call once and observe it loops without
    // resolving. To avoid hanging the suite, use a stub that throws
    // after a few polls.
    let calls = 0;
    capture.getLastBody = () => {
      calls += 1;
      if (calls > 3) throw new Error("simulated timeout");
      return null;
    };
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    await expect(assertion(page)).rejects.toThrow();
  });

  it("assertion fails when captured body lacks the sentinel", async () => {
    let calls = 0;
    const capture = {
      getLastBody: () => {
        calls += 1;
        if (calls > 3) throw new Error("simulated timeout");
        return '{"messages":[{"role":"user","content":"hi"}]}';
      },
    };
    const assertion = buildContextAssertion(
      "test",
      capture,
      CONTEXT_NAME_SENTINEL,
    );
    const page: Page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    await expect(assertion(page)).rejects.toThrow();
  });
});
