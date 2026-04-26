import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
// Top-level import triggers the script's `registerD5Script` side
// effect against the singleton registry. We do NOT clear the registry
// per-test because re-importing wouldn't re-trigger the side effect
// (vitest caches the module and ESM bindings are immutable). Instead,
// the test file imports once at the top, every test reads the same
// registered script, and assertion tests pull the `assertions`
// callback directly from the script's `buildTurns` output without
// touching the registry between tests.
import {
  buildTurns,
  buildToolRenderingAssertion,
  TOOL_CARD_SELECTORS,
} from "./d5-tool-rendering.js";

/**
 * Tests for the D5 tool-rendering script. Three concerns:
 *
 *   1. Side-effect registration — the import wires up `tool-rendering`
 *      in the registry with the correct fixtureFile.
 *   2. `buildTurns` produces the user inputs that match the recorded
 *      fixture verbatim (`weather in Tokyo`).
 *   3. The assertion fires (throws) when the DOM lacks the expected
 *      card structure — covering the four failure modes:
 *        a. selector cascade matched 0 elements,
 *        b. card matched but missing a numeric temperature,
 *        c. card matched but missing the "Tokyo" city label,
 *        d. card matched but childCount === 0 (string-only render).
 *      And green-paths through when all four checks pass.
 *
 * The Page interface is the structural minimal surface from
 * conversation-runner.ts — tests inject scripted fakes whose `evaluate`
 * returns the appropriate ToolCardProbeResult shape (or throws to model
 * a chromium hiccup). No real browser is launched.
 */

const FIXTURE_USER_MESSAGE = "weather in Tokyo";

interface FakePageScript {
  /**
   * Sequence of values the fake's `evaluate` should return. Each call
   * to `page.evaluate` shifts one off; if only one entry is provided
   * it repeats. Matches the pattern used by conversation-runner.test.ts.
   */
  evaluateValues?: unknown[];
  /** Throw on `waitForSelector` to model a non-LGP integration where
   * the canonical selector never appears (the script should still let
   * the cascade probe run). */
  throwOnWaitForSelector?: boolean;
}

function makePage(script: FakePageScript = {}): Page {
  const queue = [...(script.evaluateValues ?? [])];
  return {
    async waitForSelector() {
      if (script.throwOnWaitForSelector) {
        throw new Error("waitForSelector timeout (test fake)");
      }
    },
    async fill() {
      // Unused by these assertion tests.
    },
    async press() {
      // Unused by these assertion tests.
    },
    async evaluate() {
      if (queue.length === 0) return undefined as never;
      if (queue.length === 1) return queue[0] as never;
      return queue.shift() as never;
    },
  };
}

describe("d5-tool-rendering script", () => {
  describe("registration", () => {
    it("registers under featureType 'tool-rendering' with the canonical fixture file", () => {
      const script = getD5Script("tool-rendering");
      expect(script).toBeDefined();
      expect(script?.featureTypes).toEqual(["tool-rendering"]);
      expect(script?.fixtureFile).toBe("tool-rendering.json");
    });

    it("registers a buildTurns function that round-trips through the registry", () => {
      // The script we registered must be the same object that getD5Script
      // returns — sanity check that the registry round-trip works for
      // this featureType.
      const script = getD5Script("tool-rendering");
      expect(script?.buildTurns).toBe(buildTurns);
    });
  });

  describe("buildTurns", () => {
    it("produces one turn whose input matches the fixture user message verbatim", () => {
      const ctx: D5BuildContext = {
        integrationSlug: "langgraph-python",
        featureType: "tool-rendering",
        baseUrl: "https://example.test",
      };
      const turns = buildTurns(ctx);

      expect(turns).toHaveLength(1);
      expect(turns[0]!.input).toBe(FIXTURE_USER_MESSAGE);
      expect(typeof turns[0]!.assertions).toBe("function");
    });

    it("returns the same shape regardless of integrationSlug (no per-integration override yet)", () => {
      const a = buildTurns({
        integrationSlug: "langgraph-python",
        featureType: "tool-rendering",
        baseUrl: "https://a.test",
      });
      const b = buildTurns({
        integrationSlug: "ag2",
        featureType: "tool-rendering",
        baseUrl: "https://b.test",
      });
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.input).toBe(b[0]!.input);
    });
  });

  describe("selector cascade", () => {
    it("starts with the LGP canonical testid", () => {
      // Order matters: the most specific testid must come first so
      // probes against LGP land on it without iterating through
      // generic fallbacks. Locking the order here so a future
      // refactor that reshuffles the cascade fails this test.
      expect(TOOL_CARD_SELECTORS[0]).toBe('[data-testid="weather-card"]');
    });

    it("includes a tool-name attribute fallback for non-LGP renderers", () => {
      expect(TOOL_CARD_SELECTORS).toContain('[data-tool-name="get_weather"]');
    });

    it("includes a generic copilotkit-tool-render class fallback", () => {
      expect(TOOL_CARD_SELECTORS).toContain(".copilotkit-tool-render");
    });

    it("includes a generic copilot-tool-render testid fallback", () => {
      expect(TOOL_CARD_SELECTORS).toContain(
        '[data-testid="copilot-tool-render"]',
      );
    });
  });

  describe("assertion", () => {
    it("fails with selector-cascade message when no card is present", async () => {
      const assertion = buildToolRenderingAssertion();
      // Probe returns null selector — no card matched.
      const page = makePage({
        throwOnWaitForSelector: true,
        evaluateValues: [{ selector: null, text: "", childCount: 0 }],
      });
      await expect(assertion(page)).rejects.toThrow(
        /selector cascade matched 0 elements/,
      );
    });

    it("fails when the card matches but has no numeric temperature", async () => {
      const assertion = buildToolRenderingAssertion();
      const page = makePage({
        evaluateValues: [
          {
            selector: '[data-testid="weather-card"]',
            text: "tokyo cloudy",
            childCount: 3,
          },
        ],
      });
      await expect(assertion(page)).rejects.toThrow(
        /no numeric temperature found/,
      );
    });

    it("fails when the card matches but is missing the Tokyo city label", async () => {
      const assertion = buildToolRenderingAssertion();
      const page = makePage({
        evaluateValues: [
          {
            selector: '[data-testid="weather-card"]',
            text: "san francisco 22 sunny",
            childCount: 3,
          },
        ],
      });
      await expect(assertion(page)).rejects.toThrow(
        /missing city label "Tokyo"/,
      );
    });

    it("fails when the card matches but has no inner elements", async () => {
      const assertion = buildToolRenderingAssertion();
      const page = makePage({
        evaluateValues: [
          {
            selector: '[data-testid="weather-card"]',
            text: "tokyo 22 cloudy",
            childCount: 0,
          },
        ],
      });
      await expect(assertion(page)).rejects.toThrow(
        /no inner elements \(childCount=0\)/,
      );
    });

    it("succeeds when the card matches with temperature, Tokyo label, and inner elements", async () => {
      const assertion = buildToolRenderingAssertion();
      const page = makePage({
        evaluateValues: [
          {
            selector: '[data-testid="weather-card"]',
            text: "current weather tokyo 22°f cloudy humidity 65% wind 8 mph",
            childCount: 5,
          },
        ],
      });
      await expect(assertion(page)).resolves.toBeUndefined();
    });

    it("succeeds via a fallback selector when the canonical testid is absent", async () => {
      const assertion = buildToolRenderingAssertion();
      // Models an integration that uses `[data-tool-name="get_weather"]`
      // instead of `[data-testid="weather-card"]`. The wait on the
      // canonical selector throws (timeout); the cascade probe then
      // returns the fallback match.
      const page = makePage({
        throwOnWaitForSelector: true,
        evaluateValues: [
          {
            selector: '[data-tool-name="get_weather"]',
            text: "tokyo 22 cloudy humidity 65 wind 8",
            childCount: 4,
          },
        ],
      });
      await expect(assertion(page)).resolves.toBeUndefined();
    });
  });
});
