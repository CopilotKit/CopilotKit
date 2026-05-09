import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-tool-rendering-custom-catchall.js");

describe("D5 tool-rendering-custom-catchall — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-tool-rendering-custom-catchall.js");
  });

  it("registers under `tool-rendering-custom-catchall` only", () => {
    const script = getD5Script("tool-rendering-custom-catchall");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["tool-rendering-custom-catchall"]);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("references the tool-rendering fixture", () => {
    const script = getD5Script("tool-rendering-custom-catchall");
    expect(script?.fixtureFile).toBe("tool-rendering.json");
  });

  it("registers preNavigateRoute pointing at the canonical route", () => {
    const script = getD5Script("tool-rendering-custom-catchall");
    expect(script?.preNavigateRoute).toBeDefined();
    expect(script!.preNavigateRoute!("tool-rendering-custom-catchall")).toBe(
      "/demos/tool-rendering-custom-catchall",
    );
  });
});

describe("D5 tool-rendering-custom-catchall — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-tool-rendering-custom-catchall.js");
    }
  });

  it("returns two turns matching the prompt/tool pair contract", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "tool-rendering-custom-catchall",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };
    const turns = scriptModule.buildTurns(ctx);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.input).toBe("weather in Tokyo");
    expect(turns[1]!.input).toBe("What's the current price of AAPL?");
    expect(typeof turns[0]!.assertions).toBe("function");
    expect(typeof turns[1]!.assertions).toBe("function");
  });
});

describe("D5 tool-rendering-custom-catchall — validateCustomCatchall", () => {
  it("passes when all expected tool names render through the same testid", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      { toolNames: ["get_weather", "get_stock_price"], containerCount: 2 },
      ["get_weather", "get_stock_price"],
    );
    expect(result).toBeNull();
  });

  it("fails when no containers rendered at all", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      { toolNames: [], containerCount: 0 },
      ["get_weather"],
    );
    expect(result).toMatch(/0 containers/);
  });

  it("fails when only the first tool rendered", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      { toolNames: ["get_weather"], containerCount: 1 },
      ["get_weather", "get_stock_price"],
    );
    expect(result).toMatch(/missing tool name\(s\) \[get_stock_price\]/);
  });

  it("error message lists observed tool names for triage", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      { toolNames: ["wrong_tool"], containerCount: 1 },
      ["get_weather"],
    );
    expect(result).toMatch(/observed: \[wrong_tool\]/);
  });
});

describe("D5 tool-rendering-custom-catchall — assertCustomCatchall", () => {
  function makePageReturning(snap: unknown): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => snap as R,
    };
  }

  it("passes when both tool names rendered through the testid", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const page = makePageReturning({
      toolNames: ["get_weather", "get_stock_price"],
      containerCount: 2,
    });
    await expect(
      mod.assertCustomCatchall(page, ["get_weather", "get_stock_price"], 50),
    ).resolves.toBeUndefined();
  });

  it("throws with the missing-tool error", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const page = makePageReturning({
      toolNames: ["get_weather"],
      containerCount: 1,
    });
    await expect(
      mod.assertCustomCatchall(page, ["get_weather", "get_stock_price"], 30),
    ).rejects.toThrow(/get_stock_price/);
  });
});

describe("D5 tool-rendering-custom-catchall — exported constants", () => {
  it("exports the testid contract for cross-test reuse", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    expect(mod.CUSTOM_CATCHALL_TESTID).toBe("custom-wildcard-card");
    expect(mod.PROMPT_TOOL_PAIRS).toHaveLength(2);
    expect(mod.PROMPT_TOOL_PAIRS[0].tool).toBe("get_weather");
    expect(mod.PROMPT_TOOL_PAIRS[0].prompt).toBe("weather in Tokyo");
    expect(mod.PROMPT_TOOL_PAIRS[1].tool).toBe("get_stock_price");
    expect(mod.PROMPT_TOOL_PAIRS[1].prompt).toBe(
      "What's the current price of AAPL?",
    );
  });
});
