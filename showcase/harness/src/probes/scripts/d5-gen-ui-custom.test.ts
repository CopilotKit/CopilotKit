import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import type {
  D5_REGISTRY as D5RegistryType,
  D5Script,
} from "../helpers/d5-registry.js";

/**
 * Tests for the D5 gen-UI (custom) script.
 *
 * The probe is a SHARED probe (Showcase iron rule 1): it must run the
 * SAME contract for every `gen-ui-tool-based` integration — no
 * per-slug branching. Every integration:
 *   - sends "Show me a pie chart of revenue by category"
 *   - asserts the SVG donut/pie chart shape
 *   - asserts the second-leg narration mentions the chart
 *
 * The former slug-allowlist (`CHART_INTEGRATIONS`) that routed a
 * handful of slugs down the pie-chart path and everyone else down an
 * obsolete `generate_haiku` / HaikuCard path is GONE. All 21
 * gen-ui-tool-based pages register `render_bar_chart` +
 * `render_pie_chart`, so the shared contract is the pie-chart contract.
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

/**
 * Synthetic turn ctx for direct `turn.assertions(page, ctx)` invocations
 * in unit tests. The runner sources ctx from `waitForTurnComplete`'s
 * return value in production; tests that drive `turn.assertions`
 * directly must supply their own ctx since the contract is now
 * required (Phase 5 cutover).
 */
function syntheticCtx(
  text = "",
  bubbleIndex = 0,
): { bubbleIndex: number; text: string } {
  return { bubbleIndex, text };
}

const PIE_CHART_MESSAGE = "Show me a pie chart of revenue by category";

/**
 * A cross-section of gen-ui-tool-based slugs spanning both families of
 * the OLD allowlist: chart integrations that were already on the
 * pie-chart path, and integrations that USED to take the obsolete
 * haiku path. Every one must now select the SAME (pie-chart) contract.
 */
const GEN_UI_SLUGS = [
  "langgraph-python", // was on the allowlist (chart)
  "ms-agent-python", // was on the allowlist (chart)
  "ms-agent-dotnet", // was NOT on the allowlist (formerly haiku)
  "pydantic-ai", // was NOT on the allowlist (formerly haiku)
  "langgraph-typescript", // was NOT on the allowlist (formerly haiku)
  "agno", // was NOT on the allowlist (formerly haiku)
] as const;

/**
 * Build a pie-chart-shaped assertion page: first evaluate resolves the
 * gen-UI component selector, second resolves a healthy SVG shape.
 */
function makePieChartPage(shape: {
  hasSvg: boolean;
  circleCount: number;
  pathCount: number;
  rectCount: number;
  drawingChildren: number;
}): Page {
  let evalCount = 0;
  return makeAssertionPage({
    evaluateImpl: () => {
      evalCount++;
      if (evalCount === 1) return { selector: '[role="article"] svg' };
      return shape;
    },
  });
}

const HEALTHY_SVG = {
  hasSvg: true,
  circleCount: 5,
  pathCount: 0,
  rectCount: 0,
  drawingChildren: 5,
};

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

  // --- Shared contract: EVERY slug gets the pie-chart prompt ---

  it("buildTurns sends the pie chart message for a formerly-non-allowlisted slug (ms-agent-dotnet)", async () => {
    const { script } = await loadFreshRegistry();
    const turns = script.buildTurns({
      integrationSlug: "ms-agent-dotnet",
      featureType: "gen-ui-custom",
      baseUrl: "https://showcase-ms-agent-dotnet.example.com",
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe(PIE_CHART_MESSAGE);
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("NO slug selects a different probe contract — every gen-ui-tool-based slug sends the pie chart message", async () => {
    const { script } = await loadFreshRegistry();
    for (const slug of GEN_UI_SLUGS) {
      const turns = script.buildTurns({
        integrationSlug: slug,
        featureType: "gen-ui-custom",
        baseUrl: `https://showcase-${slug}.example.com`,
      });
      expect(turns, `slug ${slug} should build exactly one turn`).toHaveLength(
        1,
      );
      expect(
        turns[0]!.input,
        `slug ${slug} must send the shared pie chart message`,
      ).toBe(PIE_CHART_MESSAGE);
    }
  });

  // --- Pie chart shape + narration assertions run for EVERY slug ---

  it("pie chart: assertion FAILS when the rendered component has no <svg> (ms-agent-dotnet)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "ms-agent-dotnet",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    const page = makePieChartPage({
      hasSvg: false,
      circleCount: 0,
      pathCount: 0,
      rectCount: 0,
      drawingChildren: 0,
    });

    await expect(turn.assertions!(page, syntheticCtx())).rejects.toThrow(
      /no <svg> rendered/,
    );
  });

  it("pie chart: assertion FAILS when SVG has too few drawing children (pydantic-ai)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "pydantic-ai",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    const page = makePieChartPage({
      hasSvg: true,
      circleCount: 1,
      pathCount: 0,
      rectCount: 0,
      drawingChildren: 1,
    });

    await expect(turn.assertions!(page, syntheticCtx())).rejects.toThrow(
      /1 drawing children/,
    );
  });

  it("pie chart: assertion FAILS when assistant follow-up is missing expected tokens (ms-agent-dotnet)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "ms-agent-dotnet",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    const page = makePieChartPage(HEALTHY_SVG);

    await expect(
      turn.assertions!(
        page,
        syntheticCtx("Done — let me know if you want anything else."),
      ),
    ).rejects.toThrow(/missing tokens/);
  });

  it("pie chart: assertion PASSES on a healthy donut render with full narration (ms-agent-dotnet)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "ms-agent-dotnet",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    const page = makePieChartPage(HEALTHY_SVG);

    await expect(
      turn.assertions!(
        page,
        syntheticCtx(
          "Pie chart rendered above — Electronics is the largest slice, followed by Clothing, Food, and Books.",
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("pie chart: assertion PASSES for the langgraph-python control (chart integration)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-custom",
      baseUrl: "https://example.com",
    })[0]!;

    const page = makePieChartPage(HEALTHY_SVG);

    await expect(
      turn.assertions!(
        page,
        syntheticCtx(
          "Here is your pie chart of revenue by category — Electronics leads.",
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
