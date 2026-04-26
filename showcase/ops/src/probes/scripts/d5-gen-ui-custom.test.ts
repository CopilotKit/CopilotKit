import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import type {
  D5_REGISTRY as D5RegistryType,
  D5Script,
} from "../helpers/d5-registry.js";

/**
 * Tests for the D5 gen-UI (custom) script. Stricter sibling of
 * d5-gen-ui-headless: the custom tier additionally asserts a
 * STRUCTURAL match on the rendered SVG (multiple drawing children for
 * the donut PieChart).
 *
 * Module-cache caveat: see the headless test file's preamble — same
 * `vi.resetModules()` + dynamic-import dance to keep the registry
 * fresh per case.
 *
 * Coverage:
 *   1. Registration writes one entry under `gen-ui-custom` with the
 *      gen-ui-tool-based route and the recorded fixture.
 *   2. `buildTurns` returns one turn whose input matches the fixture's
 *      userMessage ("Show me a pie chart of revenue by category").
 *   3. Assertion FAILS when no `<svg>` is rendered.
 *   4. Assertion FAILS when the SVG has too few drawing children
 *      (below MIN_CHART_DRAWING_CHILDREN).
 *   5. Assertion FAILS when the SVG has rects but no circles or paths
 *      (shape doesn't match a pie/donut chart).
 *   6. Assertion FAILS when the assistant follow-up narration is
 *      missing the expected tokens ("pie", "chart").
 *   7. Assertion PASSES on a healthy render: SVG with 5 circles +
 *      narration that mentions both expected tokens.
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

  it("buildTurns returns one turn whose input matches the fixture's userMessage", async () => {
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

  it("assertion FAILS when the rendered component has no <svg>", async () => {
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
          // Cascade matched a card-shaped component (NOT an SVG chart).
          return { selector: '[data-testid="gen-ui-card"]' };
        }
        // readSvgChartShape: hasSvg false → assertion throws with the
        // "no <svg> rendered" message.
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

  it("assertion FAILS when SVG has too few drawing children (placeholder render)", async () => {
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
        // SVG present but only 1 drawing child (e.g. just the
        // background circle, no slices) — below MIN_CHART_DRAWING_CHILDREN.
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

  it("assertion FAILS when SVG has rects but no circles or paths (wrong chart shape)", async () => {
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
        // SVG with only rects (e.g. an icon-style decoration) —
        // doesn't match the donut/pie shape.
        return {
          hasSvg: true,
          circleCount: 0,
          pathCount: 0,
          rectCount: 4,
          drawingChildren: 4,
        };
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(
      /neither <circle> nor <path>/,
    );
  });

  it("assertion FAILS when assistant follow-up is missing expected tokens", async () => {
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
          // Healthy donut: 5 circles (4 slices + background).
          return {
            hasSvg: true,
            circleCount: 5,
            pathCount: 0,
            rectCount: 0,
            drawingChildren: 5,
          };
        }
        // Narration mentions neither "pie" nor "chart".
        return "Done — let me know if you want anything else.";
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/missing tokens/);
  });

  it("assertion PASSES on a healthy donut render with full narration", async () => {
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

  it("assertion PASSES when the chart uses <path> arcs instead of <circle> slices", async () => {
    // Robustness check: alternative chart libraries (e.g. recharts)
    // render slices as `<path>` arcs rather than dasharray-styled
    // `<circle>`s. The structural assertion accepts either, so the
    // probe doesn't false-fail when an integration switches chart libs.
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
            circleCount: 0,
            pathCount: 4,
            rectCount: 0,
            drawingChildren: 4,
          };
        }
        return "Pie chart rendered above with 4 slices.";
      },
    });

    await expect(turn.assertions!(page)).resolves.toBeUndefined();
  });
});
