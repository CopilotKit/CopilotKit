import { describe, it, expect, vi } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildA2uiFixedAssertion,
  preNavigateRoute,
  A2UI_FIXED_PILL_PROMPT,
} from "./d5-gen-ui-a2ui-fixed.js";

describe("d5-gen-ui-a2ui-fixed script", () => {
  it("registers under featureType 'gen-ui-a2ui-fixed'", () => {
    const script = getD5Script("gen-ui-a2ui-fixed");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-a2ui-fixed.json");
  });

  it("preNavigateRoute resolves /demos/a2ui-fixed-schema", () => {
    expect(preNavigateRoute("gen-ui-a2ui-fixed")).toBe(
      "/demos/a2ui-fixed-schema",
    );
  });

  it("buildTurns sends the SFO/JFK pill prompt with extended timeout", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-a2ui-fixed",
      baseUrl: "https://x.test",
    };
    const turn = buildTurns(ctx)[0]!;
    expect(turn.input).toBe(A2UI_FIXED_PILL_PROMPT);
    expect(turn.responseTimeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("assertion succeeds when waitForSelector resolves for the testid", async () => {
    const waitForSelector = vi.fn().mockResolvedValue(undefined);
    const page: Page = {
      waitForSelector: waitForSelector as Page["waitForSelector"],
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    const assertion = buildA2uiFixedAssertion({ timeoutMs: 100 });
    await expect(assertion(page)).resolves.toBeUndefined();
    expect(waitForSelector).toHaveBeenCalledWith(
      '[data-testid="a2ui-fixed-card"]',
      expect.objectContaining({ state: "visible" }),
    );
  });

  it("assertion fails when waitForSelector throws (testid never mounts)", async () => {
    const page: Page = {
      async waitForSelector() {
        throw new Error("timeout");
      },
      async fill() {},
      async press() {},
      async evaluate<R>() {
        return undefined as unknown as R;
      },
    };
    const assertion = buildA2uiFixedAssertion({ timeoutMs: 100 });
    await expect(assertion(page)).rejects.toThrow(/a2ui-fixed-card.*mount/);
  });
});
