import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildOpenGenUiAssertion,
  preNavigateRoute,
  OPEN_GEN_UI_PILL_PROMPT_PREFIX,
  OPEN_GEN_UI_MIN_SRCDOC_LENGTH,
} from "./d5-gen-ui-open.js";

function makePage(state: { iframeCount: number; longestSrcdoc: number }): Page {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>() {
      return state as unknown as R;
    },
  };
}

describe("d5-gen-ui-open script", () => {
  it("registers under featureType 'gen-ui-open'", () => {
    const script = getD5Script("gen-ui-open");
    expect(script).toBeDefined();
    expect(script?.fixtureFile).toBe("gen-ui-open.json");
  });

  it("buildTurns sends the first suggestion-pill prompt", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "x",
      featureType: "gen-ui-open",
      baseUrl: "https://x.test",
    };
    const turn = buildTurns(ctx)[0]!;
    expect(turn.input).toBe(OPEN_GEN_UI_PILL_PROMPT_PREFIX);
    expect(turn.responseTimeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("preNavigateRoute always returns /demos/open-gen-ui (advanced moved to its own probe)", () => {
    // Phase-2A split: this probe is scoped to the basic route only.
    // Demos containing `open-gen-ui-advanced` are routed to the
    // dedicated `d5-gen-ui-open-advanced.ts` probe, NOT this one.
    expect(
      preNavigateRoute("gen-ui-open", {
        demos: ["open-gen-ui", "open-gen-ui-advanced"],
      }),
    ).toBe("/demos/open-gen-ui");
    expect(preNavigateRoute("gen-ui-open", { demos: ["open-gen-ui"] })).toBe(
      "/demos/open-gen-ui",
    );
  });

  it("assertion succeeds when an iframe[srcdoc] mounts with non-trivial content", async () => {
    const assertion = buildOpenGenUiAssertion({ timeoutMs: 100 });
    const page = makePage({
      iframeCount: 1,
      longestSrcdoc: OPEN_GEN_UI_MIN_SRCDOC_LENGTH + 50,
    });
    await expect(assertion(page)).resolves.toBeUndefined();
  });

  it("assertion fails when no iframe mounts", async () => {
    const assertion = buildOpenGenUiAssertion({ timeoutMs: 100 });
    const page = makePage({ iframeCount: 0, longestSrcdoc: 0 });
    await expect(assertion(page)).rejects.toThrow(/iframe/);
  });

  it("assertion fails when iframe mounts but srcdoc is trivial", async () => {
    const assertion = buildOpenGenUiAssertion({ timeoutMs: 100 });
    const page = makePage({ iframeCount: 1, longestSrcdoc: 10 });
    await expect(assertion(page)).rejects.toThrow(/iframe/);
  });
});
