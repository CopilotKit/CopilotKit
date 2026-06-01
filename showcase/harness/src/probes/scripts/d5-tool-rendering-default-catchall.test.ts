import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-tool-rendering-default-catchall.js");

describe("D5 tool-rendering-default-catchall — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-tool-rendering-default-catchall.js");
  });

  it("registers under `tool-rendering-default-catchall` only", () => {
    const script = getD5Script("tool-rendering-default-catchall");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["tool-rendering-default-catchall"]);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("references the tool-rendering fixture", () => {
    const script = getD5Script("tool-rendering-default-catchall");
    expect(script?.fixtureFile).toBe("tool-rendering.json");
  });

  it("registers preNavigateRoute pointing at the canonical demo route", () => {
    const script = getD5Script("tool-rendering-default-catchall");
    expect(script?.preNavigateRoute).toBeDefined();
    expect(script!.preNavigateRoute!("tool-rendering-default-catchall")).toBe(
      "/demos/tool-rendering-default-catchall",
    );
  });
});

describe("D5 tool-rendering-default-catchall — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-tool-rendering-default-catchall.js");
    }
  });

  it("returns one turn with the canonical weather prompt", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "tool-rendering-default-catchall",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };
    const turns = scriptModule.buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("weather in Tokyo");
    expect(typeof turns[0]!.assertions).toBe("function");
  });
});

describe("D5 tool-rendering-default-catchall — validateDefaultCatchall", () => {
  it("passes when container with tool-name + status pill present", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    expect(
      mod.validateDefaultCatchall({
        containerWithToolName: true,
        statusPillPresent: true,
        observedToolNames: ["get_weather"],
      }),
    ).toBeNull();
  });

  it("fails when no container with the matching tool-name", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const err = mod.validateDefaultCatchall({
      containerWithToolName: false,
      statusPillPresent: true,
      observedToolNames: ["other_tool"],
    });
    expect(err).toMatch(/data-tool-name="get_weather"/);
    expect(err).toMatch(/other_tool/);
  });

  it("fails when no status pill present", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const err = mod.validateDefaultCatchall({
      containerWithToolName: true,
      statusPillPresent: false,
      observedToolNames: ["get_weather"],
    });
    expect(err).toMatch(/no status pill/);
  });

  it("reports '(none)' when no tool names observed", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const err = mod.validateDefaultCatchall({
      containerWithToolName: false,
      statusPillPresent: false,
      observedToolNames: [],
    });
    expect(err).toMatch(/\(none\)/);
  });
});

describe("D5 tool-rendering-default-catchall — assertDefaultCatchall", () => {
  function makePageReturning(snap: unknown): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => snap as R,
    };
  }

  it("passes when the snapshot is complete", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const page = makePageReturning({
      containerWithToolName: true,
      statusPillPresent: true,
      observedToolNames: ["get_weather"],
    });
    await expect(mod.assertDefaultCatchall(page, 50)).resolves.toBeUndefined();
  });

  it("throws when the snapshot keeps failing", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const page = makePageReturning({
      containerWithToolName: false,
      statusPillPresent: false,
      observedToolNames: [],
    });
    await expect(mod.assertDefaultCatchall(page, 30)).rejects.toThrow(
      /data-tool-name="get_weather"/,
    );
  });
});

describe("D5 tool-rendering-default-catchall — exported constants", () => {
  it("exports the contract pieces for cross-test reuse", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    expect(mod.EXPECTED_TOOL_NAME).toBe("get_weather");
    expect(mod.CATCHALL_CONTAINER_TESTID).toBe("copilot-tool-render");
    expect(mod.STATUS_PILL_TESTID).toBe("copilot-tool-render-status");
  });
});
