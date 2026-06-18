import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-tool-rendering-suppress-catchall.js");

function makePageReturning(snap: unknown): Page {
  return {
    waitForSelector: async () => undefined,
    fill: async () => undefined,
    press: async () => undefined,
    evaluate: async <R>(_fn: () => R): Promise<R> => snap as R,
  };
}

describe("D5 tool-rendering-suppress-catchall", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-tool-rendering-suppress-catchall.js");
  });

  it("registers under the suppress-catchall feature type", () => {
    const script = getD5Script("tool-rendering-suppress-catchall");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["tool-rendering-suppress-catchall"]);
    expect(script?.fixtureFile).toBe("tool-rendering-suppress-catchall.json");
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("targets the suppress-catchall demo route", () => {
    const script = getD5Script("tool-rendering-suppress-catchall");
    expect(script?.preNavigateRoute?.("tool-rendering-suppress-catchall")).toBe(
      "/demos/tool-rendering-suppress-catchall",
    );
  });

  it("builds the canonical weather turn", () => {
    const turns = scriptModule.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "tool-rendering-suppress-catchall",
      baseUrl: "https://example.test",
    } satisfies D5BuildContext);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("forecast for Tokyo");
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("passes when final text is present and no renderer DOM appears", () => {
    expect(
      scriptModule.validateSuppressedToolRendering({
        defaultRendererCount: 0,
        customCatchallCount: 0,
        weatherCardCount: 0,
        anyToolNameCount: 0,
        bodyText: "Tokyo is 22°C and partly cloudy.",
      }),
    ).toBeNull();
  });

  it("fails when final text never appears", () => {
    expect(
      scriptModule.validateSuppressedToolRendering({
        defaultRendererCount: 0,
        customCatchallCount: 0,
        weatherCardCount: 0,
        anyToolNameCount: 0,
        bodyText: "No matching assistant text yet.",
      }),
    ).toMatch(/expected final assistant text/);
  });

  it("fails when the built-in catch-all renderer paints the suppressed tool", () => {
    expect(
      scriptModule.validateSuppressedToolRendering({
        defaultRendererCount: 1,
        customCatchallCount: 0,
        weatherCardCount: 0,
        anyToolNameCount: 1,
        bodyText: "Tokyo is 22°C and partly cloudy.",
      }),
    ).toMatch(/built-in catch-all renderer/);
  });

  it("assertion resolves for a passing snapshot", async () => {
    const page = makePageReturning({
      defaultRendererCount: 0,
      customCatchallCount: 0,
      weatherCardCount: 0,
      anyToolNameCount: 0,
      bodyText: "Tokyo is 22°C and partly cloudy.",
    });

    await expect(
      scriptModule.assertSuppressedToolRendering(page, 50),
    ).resolves.toBeUndefined();
  });

  it("assertion rejects for a persistent renderer leak", async () => {
    const page = makePageReturning({
      defaultRendererCount: 1,
      customCatchallCount: 0,
      weatherCardCount: 0,
      anyToolNameCount: 1,
      bodyText: "Tokyo is 22°C and partly cloudy.",
    });

    await expect(
      scriptModule.assertSuppressedToolRendering(page, 30),
    ).rejects.toThrow(/built-in catch-all renderer/);
  });
});
