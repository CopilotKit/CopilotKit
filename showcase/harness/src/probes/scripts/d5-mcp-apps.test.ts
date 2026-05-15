import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-mcp-apps.js");

describe("D5 mcp-apps script — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-mcp-apps.js");
  });

  it("registers under `mcp-apps` feature type only", () => {
    const script = getD5Script("mcp-apps");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["mcp-apps"]);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("references the canonical fixture file", () => {
    const script = getD5Script("mcp-apps");
    expect(script?.fixtureFile).toBe("mcp-apps.json");
  });

  it("does NOT register a preNavigateRoute (defaults to /demos/mcp-apps)", () => {
    const script = getD5Script("mcp-apps");
    expect(script?.preNavigateRoute).toBeUndefined();
  });
});

describe("D5 mcp-apps script — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-mcp-apps.js");
    }
  });

  it("returns one turn that runs the iframe-presence assertion", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "mcp-apps",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };
    const turns = scriptModule.buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("drives a real MCP-tool prompt (not the previous 'hello' no-op)", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "mcp-apps",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };
    const turns = scriptModule.buildTurns(ctx);
    // Verbatim pill prompt from
    // `langgraph-python/src/app/demos/mcp-apps/suggestions.ts`.
    expect(turns[0]!.input).toBe(
      "Open Excalidraw and sketch a system diagram with a client, server, and database.",
    );
    expect(turns[0]!.input).not.toBe("hello");
  });
});

describe("D5 mcp-apps assertIframePresent", () => {
  function makePageReturning(value: string | null): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      // The script's evaluate runs a function that returns a string|null.
      // Our fake bypasses the DOM and returns the scripted value verbatim.
      evaluate: async <R>(_fn: () => R): Promise<R> => value as unknown as R,
    };
  }

  it("passes when the canonical testid selector matches", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page = makePageReturning('[data-testid="mcp-app-iframe"]');
    await expect(mod.assertIframePresent(page, 50)).resolves.toBeUndefined();
  });

  it("passes when only the sandbox-iframe fallback matches", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page = makePageReturning("iframe[sandbox]");
    await expect(mod.assertIframePresent(page, 50)).resolves.toBeUndefined();
  });

  it("throws when neither selector matches within the timeout", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page = makePageReturning(null);
    await expect(mod.assertIframePresent(page, 50)).rejects.toThrow(
      /mcp-apps: expected iframe/,
    );
  });

  it("error message lists the cascade selectors", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page = makePageReturning(null);
    await expect(mod.assertIframePresent(page, 30)).rejects.toThrow(
      /iframe\[sandbox\]/,
    );
  });
});

describe("D5 mcp-apps probeIframeSelector", () => {
  it("returns the value the page-side function emits", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page: Page = {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> =>
        '[data-testid="mcp-app-iframe"]' as unknown as R,
    };
    await expect(mod.probeIframeSelector(page)).resolves.toBe(
      '[data-testid="mcp-app-iframe"]',
    );
  });

  it("propagates null when nothing matched", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const page: Page = {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => null as unknown as R,
    };
    await expect(mod.probeIframeSelector(page)).resolves.toBeNull();
  });
});

describe("D5 mcp-apps script — exported selector cascade", () => {
  it("includes the canonical testid first and the sandbox fallback second", async () => {
    const mod = await import("./d5-mcp-apps.js");
    expect(mod.MCP_APP_IFRAME_SELECTORS[0]).toBe(
      '[data-testid="mcp-app-iframe"]',
    );
    expect(mod.MCP_APP_IFRAME_SELECTORS[1]).toBe("iframe[sandbox]");
  });
});
