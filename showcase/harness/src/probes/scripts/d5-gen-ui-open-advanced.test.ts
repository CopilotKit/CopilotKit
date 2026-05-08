import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-gen-ui-open-advanced.js");

describe("D5 gen-ui-open-advanced — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-gen-ui-open-advanced.js");
  });

  it("registers under `gen-ui-open-advanced` only", () => {
    const script = getD5Script("gen-ui-open-advanced");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["gen-ui-open-advanced"]);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("references the gen-ui-open fixture (shared with basic tier)", () => {
    const script = getD5Script("gen-ui-open-advanced");
    expect(script?.fixtureFile).toBe("gen-ui-open.json");
  });

  it("registers preNavigateRoute pointing at /demos/open-gen-ui-advanced", () => {
    const script = getD5Script("gen-ui-open-advanced");
    expect(script?.preNavigateRoute).toBeDefined();
    expect(script!.preNavigateRoute!("gen-ui-open-advanced")).toBe(
      "/demos/open-gen-ui-advanced",
    );
  });
});

describe("D5 gen-ui-open-advanced — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-gen-ui-open-advanced.js");
    }
  });

  it("returns one turn driving a fixture-keyed advanced sandbox prompt", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "gen-ui-open-advanced",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };
    const turns = scriptModule.buildTurns(ctx);
    expect(turns).toHaveLength(1);
    // Verbatim pill prompt from `open-gen-ui-advanced/suggestions.ts`,
    // keyed in `d5-all.json` to a deterministic generateSandboxedUi
    // tool call.
    expect(turns[0]!.input).toBe("Inline expression evaluator");
    expect(typeof turns[0]!.assertions).toBe("function");
  });
});

describe("D5 gen-ui-open-advanced — assertAdvancedIframe", () => {
  function makePageReturning(value: string | null): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => value as unknown as R,
    };
  }

  it("passes when the canonical advanced testid matches", async () => {
    const mod = await import("./d5-gen-ui-open-advanced.js");
    const page = makePageReturning(
      '[data-testid="gen-ui-open-advanced-iframe"]',
    );
    await expect(mod.assertAdvancedIframe(page, 50)).resolves.toBeUndefined();
  });

  it("passes on the sandbox-iframe fallback", async () => {
    const mod = await import("./d5-gen-ui-open-advanced.js");
    const page = makePageReturning('iframe[sandbox*="allow-scripts"]');
    await expect(mod.assertAdvancedIframe(page, 50)).resolves.toBeUndefined();
  });

  it("throws when no iframe matches within the timeout", async () => {
    const mod = await import("./d5-gen-ui-open-advanced.js");
    const page = makePageReturning(null);
    await expect(mod.assertAdvancedIframe(page, 30)).rejects.toThrow(
      /gen-ui-open-advanced: expected iframe/,
    );
  });
});

describe("D5 gen-ui-open-advanced — exported selector cascade", () => {
  it("orders canonical testid first, sandbox-iframe fallback second", async () => {
    const mod = await import("./d5-gen-ui-open-advanced.js");
    expect(mod.ADVANCED_IFRAME_SELECTORS[0]).toBe(
      '[data-testid="gen-ui-open-advanced-iframe"]',
    );
    expect(mod.ADVANCED_IFRAME_SELECTORS[1]).toBe(
      'iframe[sandbox*="allow-scripts"]',
    );
  });

  it("does not include the bare iframe selector (would over-match)", async () => {
    const mod = await import("./d5-gen-ui-open-advanced.js");
    expect(
      (mod.ADVANCED_IFRAME_SELECTORS as readonly string[]).includes("iframe"),
    ).toBe(false);
  });
});
