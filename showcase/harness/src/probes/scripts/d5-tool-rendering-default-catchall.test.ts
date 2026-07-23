import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
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
    expect(script?.fixtureFile).toBe("tool-rendering-default-catchall.json");
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
    expect(turns[0]!.input).toBe("forecast for Tokyo");
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

// Regression test for PR #5495 A25a fix (CR Finding 1). The default
// catchall probe historically used the broken
// `page.evaluate((arg?: string) => { ... }, leakPhrase)` arg-passing
// pattern. Empirically, `arg` arrives as `undefined` inside the
// browser-side closure, so `if (needle)` guarded the entire leak-detection
// cascade as dead code and `customLeakPhrasePresent` stayed `false`
// forever — making `validateDefaultCatchall`'s leak branch dead code
// too. The A25a fix mirrors the A11 sibling probe's pattern by
// inlining the needle as a JS literal in the closure body. This test
// asserts the invariant directly via the function source so a
// revert would re-fail.
describe("D5 tool-rendering-default-catchall — inline-needle invariant (regression)", () => {
  function findEvaluateCallSource(fnSource: string): string {
    const idx = fnSource.indexOf("page.evaluate(");
    expect(idx).toBeGreaterThanOrEqual(0);
    return fnSource.slice(idx);
  }

  it("probeDefaultCatchall inlines the leak phrase as a string literal", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const src = mod.probeDefaultCatchall.toString();
    const evalCall = findEvaluateCallSource(src);
    expect(evalCall).toContain(mod.CUSTOM_CATCHALL_LEAK_PHRASE);
  });

  it("probeDefaultCatchall does NOT pass the needle via a page.evaluate second-arg", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const src = mod.probeDefaultCatchall.toString();
    // The historical broken form had a parameter on the closure:
    //   page.evaluate((expectedLeakPhrase?: string) => { ... }, leakPhrase)
    // The fixed form takes no parameters.
    expect(src).not.toMatch(/page\.evaluate\(\s*\(\s*expectedLeakPhrase/);
    expect(src).not.toMatch(/page\.evaluate\(\s*\(\s*expectedPhrase/);
    // The call must not have a second arg — the closure should close
    // with `})` not `}, x)`.
    const tail = src.slice(-200);
    expect(tail).toMatch(/\}\s*\)\s*;?\s*\}?\s*$/);
    expect(tail).not.toMatch(/\},\s*[A-Za-z_$"]/);
  });
});

// Coverage for the leak-detection branch of validateDefaultCatchall.
// The branch was added to detect cross-fixture leaks from the
// custom-catchall fixture into a default-catchall request. Without
// this coverage, reverting the leak check would not be caught by
// any other test.
describe("D5 tool-rendering-default-catchall — customLeakPhrasePresent branch (regression)", () => {
  it("fails when leak phrase is present in the snapshot", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    const err = mod.validateDefaultCatchall({
      containerWithToolName: true,
      statusPillPresent: true,
      observedToolNames: ["get_weather"],
      customLeakPhrasePresent: true,
    });
    expect(err).not.toBeNull();
    expect(err).toMatch(/custom-catchall/);
    expect(err).toMatch(/leaked/);
    expect(err).toContain(mod.CUSTOM_CATCHALL_LEAK_PHRASE);
  });

  it("passes when leak phrase is absent (false)", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    expect(
      mod.validateDefaultCatchall({
        containerWithToolName: true,
        statusPillPresent: true,
        observedToolNames: ["get_weather"],
        customLeakPhrasePresent: false,
      }),
    ).toBeNull();
  });

  it("passes when leak phrase is undefined (absence == false)", async () => {
    const mod = await import("./d5-tool-rendering-default-catchall.js");
    expect(
      mod.validateDefaultCatchall({
        containerWithToolName: true,
        statusPillPresent: true,
        observedToolNames: ["get_weather"],
        // customLeakPhrasePresent omitted — treated as false.
      }),
    ).toBeNull();
  });
});
