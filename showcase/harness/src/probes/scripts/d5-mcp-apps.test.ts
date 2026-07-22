import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import type * as D5MCPAppsScript from "./d5-mcp-apps.js";

let scriptModule: typeof D5MCPAppsScript;

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
    expect(typeof turns[0]!.preFill).toBe("function");
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

describe("D5 mcp-apps armMcpInitializeProbe", () => {
  it("marks only the iframe that emitted a valid ui/initialize request", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const expectedSource = {};
    const unrelatedSource = {};
    const expectedAttributes = new Map<string, string>();
    const unrelatedAttributes = new Map<string, string>();
    let onMessage:
      | ((event: { data: unknown; source: unknown }) => void)
      | undefined;
    const originalWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: (
          type: string,
          listener: (event: { data: unknown; source: unknown }) => void,
        ) => {
          if (type === "message") onMessage = listener;
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelectorAll: () => [
          {
            contentWindow: expectedSource,
            setAttribute: (name: string, value: string) =>
              expectedAttributes.set(name, value),
          },
          {
            contentWindow: unrelatedSource,
            setAttribute: (name: string, value: string) =>
              unrelatedAttributes.set(name, value),
          },
        ],
      },
    });
    const page: Page = {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(fn: () => R): Promise<R> => fn(),
    };

    try {
      await mod.armMcpInitializeProbe(page);
      onMessage?.({
        data: { jsonrpc: "2.0", method: "ui/initialize", id: 1 },
        source: expectedSource,
      });
      expect(expectedAttributes.get("data-mcp-app-initialized")).toBe("true");
      expect(unrelatedAttributes.has("data-mcp-app-initialized")).toBe(false);
    } finally {
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    }
  });
});

describe("D5 mcp-apps assertIframePresent", () => {
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

  it("rejects a populated iframe whose CSP-blocked app never initializes", async () => {
    const mod = await import("./d5-mcp-apps.js");
    const originalDocument = Object.getOwnPropertyDescriptor(
      globalThis,
      "document",
    );
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        querySelector: (selector: string) =>
          selector === '[data-testid="mcp-app-iframe"]'
            ? { getAttribute: () => null }
            : null,
      },
    });
    const page: Page = {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(fn: () => R): Promise<R> => fn(),
    };

    try {
      await expect(mod.assertIframePresent(page, 50)).rejects.toThrow(
        /fully initialized embedded UI/,
      );
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, "document", originalDocument);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    }
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
