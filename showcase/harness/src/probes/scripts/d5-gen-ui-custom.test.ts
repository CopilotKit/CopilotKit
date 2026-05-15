import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import type {
  D5_REGISTRY as D5RegistryType,
  D5Script,
} from "../helpers/d5-registry.js";

/**
 * Tests for the D5 gen-UI (custom) script. The script now branches on
 * integrationSlug:
 *   - `langgraph-python` sends "Show me a pie chart..." and asserts
 *     SVG donut chart shape.
 *   - All others send "Write me a haiku about nature" and assert
 *     the HaikuCard rendering.
 *
 * Module-cache caveat: see the headless test file's preamble — same
 * `vi.resetModules()` + dynamic-import dance to keep the registry
 * fresh per case.
 */

interface FreshRegistry {
  registry: typeof D5RegistryType;
  script: D5Script;
}

async function loadFreshRegistry(): Promise<FreshRegistry> {
  vi.resetModules();
  const registryMod = await import("../helpers/d5-registry.js");
  registryMod.__clearD5RegistryForTesting();
  await import("./d5-gen-ui-custom.js");
  const script = registryMod.getD5Script("gen-ui-custom");
  if (!script) {
    throw new Error("d5-gen-ui-custom.js did not register a script");
  }
  return { registry: registryMod.D5_REGISTRY, script };
}

function makeAssertionPage(opts: {
  evaluateImpl: (fn: () => unknown) => unknown;
}): Page {
  return {
    async waitForSelector() {
      /* no-op */
    },
    async fill() {
      /* no-op */
    },
    async press() {
      /* no-op */
    },
    async evaluate(fn) {
      return opts.evaluateImpl(fn) as never;
    },
  };
}

describe("d5-gen-ui-custom script", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers the script under gen-ui-custom with the expected fixture + route", async () => {
    const { registry, script } = await loadFreshRegistry();
    expect(script.fixtureFile).toBe("gen-ui-custom.json");
    expect(script.featureTypes).toEqual(["gen-ui-custom"]);
    expect(registry.size).toBe(1);
    expect(script.preNavigateRoute?.("gen-ui-custom")).toBe(
      "/demos/gen-ui-tool-based",
    );
  });

  it("buildTurns sends pie chart message for langgraph-python", async () => {
    const { script } = await loadFreshRegistry();
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://showcase-langgraph-python.example.com",
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("Show me a pie chart of revenue by category");
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("buildTurns sends haiku message for non-langgraph-python integrations", async () => {
    const { script } = await loadFreshRegistry();
    const turns = script.buildTurns({
      integrationSlug: "agno",
      featureType: "gen-ui-custom",
      baseUrl: "https://showcase-agno.example.com",
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("Write me a haiku about nature");
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  // --- Pie chart path (langgraph-python) ---

  it("pie chart: assertion FAILS when the rendered component has no <svg>", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) {
          return { selector: '[data-testid="gen-ui-card"]' };
        }
        return {
          hasSvg: false,
          circleCount: 0,
          pathCount: 0,
          rectCount: 0,
          drawingChildren: 0,
        };
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/no <svg> rendered/);
  });

  it("pie chart: assertion FAILS when SVG has too few drawing children", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[role="article"] svg' };
        return {
          hasSvg: true,
          circleCount: 1,
          pathCount: 0,
          rectCount: 0,
          drawingChildren: 1,
        };
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/1 drawing children/);
  });

  it("pie chart: assertion FAILS when assistant follow-up is missing expected tokens", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[role="article"] svg' };
        if (evalCount === 2) {
          return {
            hasSvg: true,
            circleCount: 5,
            pathCount: 0,
            rectCount: 0,
            drawingChildren: 5,
          };
        }
        return "Done — let me know if you want anything else.";
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/missing tokens/);
  });

  it("pie chart: assertion PASSES on a healthy donut render with full narration", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[role="article"] svg' };
        if (evalCount === 2) {
          return {
            hasSvg: true,
            circleCount: 5,
            pathCount: 0,
            rectCount: 0,
            drawingChildren: 5,
          };
        }
        return "Pie chart rendered above — Electronics is the largest slice, followed by Clothing, Food, and Books.";
      },
    });

    await expect(turn.assertions!(page)).resolves.toBeUndefined();
  });

  // --- Haiku card path (all non-LGP integrations) ---

  it("haiku: assertion FAILS when no card or component renders", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "agno",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) {
          // Cascade matched a generic selector
          return { selector: '[data-message-role="assistant"]' };
        }
        // No haiku card or rendered component found
        return { found: false };
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(
      /no haiku card or rendered component/,
    );
  });

  it("haiku: assertion FAILS when haiku card has zero children (empty wrapper)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "mastra",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) {
          return { selector: '[data-testid="haiku-card"]' };
        }
        // Haiku card found but empty
        return {
          found: true,
          selector: '[data-testid="haiku-card"]',
          childCount: 0,
          hasText: false,
          japaneseLineCount: 0,
          englishLineCount: 0,
        };
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/zero children/);
  });

  it("haiku: assertion PASSES on a healthy haiku card render (no narration check)", async () => {
    // Haiku integrations use `useFrontendTool` with `followUp: false`,
    // so there is no second-leg narration. Only the structural check
    // (card rendered with children + text) is asserted.
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "agno",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) {
          return { selector: '[data-testid="haiku-card"]' };
        }
        // assertHaikuCardShape: card found with children and text
        return {
          found: true,
          selector: '[data-testid="haiku-card"]',
          childCount: 3,
          hasText: true,
          japaneseLineCount: 3,
          englishLineCount: 3,
        };
      },
    });

    await expect(turn.assertions!(page)).resolves.toBeUndefined();
  });

  it("haiku: assertion PASSES with fallback selector (no testid)", async () => {
    // Some integrations might render the component without testids.
    // The probe falls back to generic assistant message selectors.
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-typescript",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) {
          return { selector: '[data-message-role="assistant"]' };
        }
        // Fallback: no haiku-card testid, but assistant message
        // wrapper has children and text
        return {
          found: true,
          selector: '[data-message-role="assistant"]',
          childCount: 2,
          hasText: true,
          japaneseLineCount: 0,
          englishLineCount: 0,
        };
      },
    });

    await expect(turn.assertions!(page)).resolves.toBeUndefined();
  });
});
