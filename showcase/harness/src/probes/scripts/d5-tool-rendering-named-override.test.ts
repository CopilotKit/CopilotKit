import { describe, it, expect, beforeAll } from "vitest";
import {
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-tool-rendering-named-override.js");

function makePageReturning(snap: unknown): Page {
  return {
    waitForSelector: async () => undefined,
    fill: async () => undefined,
    press: async () => undefined,
    evaluate: async <R>(_fn: () => R): Promise<R> => snap as R,
  };
}

describe("D5 tool-rendering-named-override", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-tool-rendering-named-override.js");
  });

  it("registers under the named-override feature type", () => {
    const script = getD5Script("tool-rendering-named-override");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["tool-rendering-named-override"]);
    expect(script?.fixtureFile).toBe("tool-rendering-named-override.json");
  });

  it("targets the named-override demo route", () => {
    const script = getD5Script("tool-rendering-named-override");
    expect(script?.preNavigateRoute?.("tool-rendering-named-override")).toBe(
      "/demos/tool-rendering-named-override",
    );
  });

  it("builds weather suppression followed by stock catch-all", () => {
    const turns = scriptModule.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "tool-rendering-named-override",
      baseUrl: "https://example.test",
    } satisfies D5BuildContext);

    expect(turns).toHaveLength(2);
    expect(turns[0]!.input).toBe("named override weather suppression case");
    expect(turns[1]!.input).toBe("named override stock fallthrough case");
  });

  it("validates the stock tool falling through to the built-in catch-all", () => {
    expect(
      scriptModule.validateStockCatchall({
        containerWithToolName: true,
        statusPillPresent: true,
        statusAttributePresent: true,
        observedToolNames: ["get_stock_price"],
        observedStatuses: ["complete"],
      }),
    ).toBeNull();
  });

  it("fails when the stock catch-all container is missing", () => {
    expect(
      scriptModule.validateStockCatchall({
        containerWithToolName: false,
        statusPillPresent: false,
        statusAttributePresent: false,
        observedToolNames: ["get_weather"],
        observedStatuses: [],
      }),
    ).toMatch(/get_stock_price/);
  });

  it("fails when the status pill is missing", () => {
    expect(
      scriptModule.validateStockCatchall({
        containerWithToolName: true,
        statusPillPresent: false,
        statusAttributePresent: true,
        observedToolNames: ["get_stock_price"],
        observedStatuses: ["complete"],
      }),
    ).toMatch(/no status pill/);
  });

  it("assertion resolves for a passing stock catch-all snapshot", async () => {
    const page = makePageReturning({
      containerWithToolName: true,
      statusPillPresent: true,
      statusAttributePresent: true,
      observedToolNames: ["get_stock_price"],
      observedStatuses: ["complete"],
    });

    await expect(
      scriptModule.assertStockFallsThroughToCatchall(page, 50),
    ).resolves.toBeUndefined();
  });

  it("assertion rejects for a persistent stock catch-all miss", async () => {
    const page = makePageReturning({
      containerWithToolName: false,
      statusPillPresent: false,
      statusAttributePresent: false,
      observedToolNames: [],
      observedStatuses: [],
    });

    await expect(
      scriptModule.assertStockFallsThroughToCatchall(page, 30),
    ).rejects.toThrow(/get_stock_price/);
  });
});
