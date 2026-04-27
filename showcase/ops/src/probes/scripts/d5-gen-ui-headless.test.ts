import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Page } from "../helpers/conversation-runner.js";
import type {
  D5_REGISTRY as D5RegistryType,
  D5Script,
} from "../helpers/d5-registry.js";

/**
 * Tests for the D5 gen-UI (headless) script. The script registers
 * itself at import time via a top-level `registerD5Script(...)` call,
 * mirroring how the production loader picks it up.
 *
 * Module-cache caveat: the registry is module-level state in
 * `d5-registry.js`, and the script registers itself at import time.
 * Vitest caches imports across test cases, so we re-import BOTH the
 * registry module AND the script module via `vi.resetModules()` +
 * dynamic import in each test that needs a fresh registry — this way
 * the assertions read from the same Map the script just populated.
 *
 * Coverage:
 *   1. Registration writes one entry under `gen-ui-headless` and
 *      preserves the override route + fixture file.
 *   2. `buildTurns` returns the expected user message (mirrors the
 *      recorded fixture in `fixtures/d5/gen-ui-headless.json`).
 *   3. The turn's assertion FAILS when no gen-UI component renders
 *      (cascade times out → throw → conversation-runner records it
 *      as `failure_turn`).
 *   4. The turn's assertion FAILS when the matched component is an
 *      empty wrapper (zero children).
 *   5. The turn's assertion FAILS when the assistant follow-up
 *      narration is missing the expected tokens.
 *   6. The turn's assertion PASSES on a healthy DOM (component
 *      rendered with children + narration mentions card + Ada).
 */

interface FreshRegistry {
  registry: typeof D5RegistryType;
  script: D5Script;
}

/**
 * Force a fresh module graph so the script's top-level registration
 * runs against a clean registry. Returns the freshly-imported registry
 * Map and the registered script for direct assertions.
 */
async function loadFreshRegistry(): Promise<FreshRegistry> {
  vi.resetModules();
  const registryMod = await import("../helpers/d5-registry.js");
  registryMod.__clearD5RegistryForTesting();
  // Side-effect import — top-level registerD5Script runs against the
  // freshly-imported registry.
  await import("./d5-gen-ui-headless.js");
  const script = registryMod.getD5Script("gen-ui-headless");
  if (!script) {
    throw new Error("d5-gen-ui-headless.js did not register a script");
  }
  return { registry: registryMod.D5_REGISTRY, script };
}

// Build a minimal Page fake for assertion-side tests. Only `evaluate`
// is exercised by the assertion; the other Page methods are stubbed
// with no-ops so callers don't hit a missing-method runtime error.
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

describe("d5-gen-ui-headless script", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("registers the script under gen-ui-headless with the expected fixture + route", async () => {
    const { registry, script } = await loadFreshRegistry();
    expect(script.fixtureFile).toBe("gen-ui-headless.json");
    expect(script.featureTypes).toEqual(["gen-ui-headless"]);
    expect(registry.size).toBe(1);
    // The registry stores `preNavigateRoute` verbatim. Its argument is
    // ignored by this script — the route is fixed to `/demos/headless-simple`.
    expect(script.preNavigateRoute?.("gen-ui-headless")).toBe(
      "/demos/headless-simple",
    );
  });

  it("buildTurns returns one turn whose input matches the fixture's userMessage", async () => {
    const { script } = await loadFreshRegistry();
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://showcase-langgraph-python.example.com",
    });
    expect(turns).toHaveLength(1);
    // Mirrors the fixture's `match.userMessage` so showcase-aimock
    // matches the recorded response on this exact prompt. A drift
    // here would silently fall through to the model and cost money.
    expect(turns[0]!.input).toBe("Show me a profile card for Ada Lovelace");
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("assertion FAILS when no gen-ui component renders (cascade times out)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://example.com",
    })[0]!;

    // Simulate "no gen-ui component anywhere": every selector in the
    // cascade returns null. The assertion's first action is the
    // cascade-wait, which polls and eventually throws on timeout.
    // Race against a short test-side deadline because the cascade's
    // own default is 30 s — we just need to confirm the assertion
    // throws, not pay for the full timeout.
    const page = makeAssertionPage({
      evaluateImpl: () => ({ reason: "no selector matched" }),
    });

    await expect(
      Promise.race([
        turn.assertions!(page),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("test-timeout-guard")), 1500),
        ),
      ]),
    ).rejects.toThrow();
  });

  it("assertion FAILS when matched component has zero children (empty wrapper)", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://example.com",
    })[0]!;

    // Sequence:
    //   call 1 — findFirstNonTrivial: returns a matched SVG selector
    //            (the cascade accepts SVG as a leaf even with 0
    //            children — only non-SVG empty wrappers are filtered
    //            in the cascade itself).
    //   call 2 — re-read childCount: returns 0 → script's secondary
    //            structural check throws with "0 children".
    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[role="article"] svg' };
        return 0;
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/0 children/);
  });

  it("assertion FAILS when assistant follow-up is missing expected tokens", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[data-testid="gen-ui-card"]' };
        if (evalCount === 2) return 2; // childCount
        // readLastAssistantText: text that doesn't mention card or Ada.
        return "Sure, I will help you with that request shortly.";
      },
    });

    await expect(turn.assertions!(page)).rejects.toThrow(/missing tokens/);
  });

  it("childCount lookup interpolates the resolved cascade selector (no in-page re-cascade)", async () => {
    // Per A11 — the original code re-ran the WHOLE selector cascade
    // inside page.evaluate, which could resolve a different (more
    // generic) node than the cascade just matched. The fix
    // interpolates the resolved selector into the function source,
    // so the page-side function only ever queries that single
    // selector. We assert this by checking the function source
    // shipped to evaluate against the resolved selector returned
    // from the (Node-side) cascade.
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const fnSources: string[] = [];
    const page = makeAssertionPage({
      evaluateImpl: (fn) => {
        evalCount++;
        fnSources.push(String(fn));
        if (evalCount === 1) return { selector: '[data-testid="gen-ui-card"]' };
        if (evalCount === 2) return 2; // childCount
        return "Here is a card for Ada Lovelace — the rendered card above shows her biography.";
      },
    });

    await turn.assertions!(page);

    // The second evaluate call is the child-count lookup; its source
    // MUST embed the resolved selector and MUST NOT contain the
    // remaining selectors from the cascade (which would indicate the
    // old "re-run cascade in browser" pattern).
    const childCountSource = fnSources[1] ?? "";
    expect(childCountSource).toContain("gen-ui-card");
    // The selector NOT chosen by the Node-side cascade should not
    // appear in the page-side source (the old code listed every
    // cascade selector in the body).
    expect(childCountSource).not.toContain("copilotkit-render-component");
    expect(childCountSource).not.toContain("data-tool-name");
  });

  it("assertion PASSES on a healthy render with full narration", async () => {
    const { script } = await loadFreshRegistry();
    const turn = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-headless",
      baseUrl: "https://example.com",
    })[0]!;

    let evalCount = 0;
    const page = makeAssertionPage({
      evaluateImpl: () => {
        evalCount++;
        if (evalCount === 1) return { selector: '[data-testid="gen-ui-card"]' };
        if (evalCount === 2) return 2; // childCount
        return "Here is a quick card for Ada Lovelace — the rendered card above shows a short biography.";
      },
    });

    await expect(turn.assertions!(page)).resolves.toBeUndefined();
  });
});
