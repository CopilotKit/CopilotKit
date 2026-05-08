import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildReasoningAssertion,
  preNavigateRoute,
  REASONING_SELECTORS,
} from "./d5-reasoning-display.js";

/** Build a fake Page whose `evaluate()` returns a caller-supplied
 *  value. The reasoning probe's only `evaluate` callsite is the
 *  testid presence check (`hasReasoningMessage`), so the value must
 *  be a boolean. */
function makePage(reasoningPresent: boolean): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return reasoningPresent as unknown as R;
    },
  };
}

describe("d5-reasoning-display script", () => {
  it("registers under featureType 'reasoning-display'", () => {
    const script = getD5Script("reasoning-display");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["reasoning-display"]);
    expect(script?.fixtureFile).toBe("reasoning-display.json");
  });

  it("buildTurns input matches fixture", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "reasoning-display",
      baseUrl: "https://x.test",
    };
    expect(buildTurns(ctx)[0]!.input).toBe("show your reasoning step by step");
  });

  it("preNavigateRoute defaults to /demos/reasoning-custom", () => {
    expect(preNavigateRoute("reasoning-display")).toBe(
      "/demos/reasoning-custom",
    );
  });

  it("preNavigateRoute prefers reasoning-default when only that demo is declared", () => {
    expect(
      preNavigateRoute("reasoning-display", {
        demos: ["reasoning-default"],
      }),
    ).toBe("/demos/reasoning-default");
  });

  it("REASONING_SELECTORS lists the four stable role/testid markers", () => {
    expect(REASONING_SELECTORS).toContain('[data-testid="reasoning-block"]');
    expect(REASONING_SELECTORS).toContain('[data-testid="reasoning-content"]');
    expect(REASONING_SELECTORS).toContain('[data-testid="reasoning-default"]');
    expect(REASONING_SELECTORS).toContain('[data-message-role="reasoning"]');
  });

  it("assertion succeeds when a reasoning-role testid is present", async () => {
    const assertion = buildReasoningAssertion({ timeoutMs: 200 });
    const page = makePage(true);
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when no reasoning testid renders within timeout", async () => {
    const assertion = buildReasoningAssertion({ timeoutMs: 200 });
    const page = makePage(false);
    await expect(assertion(page)).rejects.toThrow(
      /no reasoning-role message rendered/,
    );
  });
});
