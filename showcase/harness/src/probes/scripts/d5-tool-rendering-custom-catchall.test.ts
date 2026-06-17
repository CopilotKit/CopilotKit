import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
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
    expect(script?.fixtureFile).toBe("tool-rendering-custom-catchall.json");
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
    // LGP-gold disjoint-prompts pattern (supersedes #5465): both
    // prompts must be unique substrings that no default-catchall
    // fixture matcher can satisfy. See PROMPT_TOOL_PAIRS comment.
    expect(turns[0]!.input).toBe(
      "Forecast Tokyo through the wildcard renderer",
    );
    expect(turns[1]!.input).toBe("Quote AAPL through the wildcard renderer");
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
    expect(mod.PROMPT_TOOL_PAIRS[0].prompt).toBe(
      "Forecast Tokyo through the wildcard renderer",
    );
    expect(mod.PROMPT_TOOL_PAIRS[1].tool).toBe("get_stock_price");
    expect(mod.PROMPT_TOOL_PAIRS[1].prompt).toBe(
      "Quote AAPL through the wildcard renderer",
    );
    expect(mod.CUSTOM_CATCHALL_CONTENT_PHRASE).toBe(
      "rendered through the custom wildcard catchall",
    );
  });
});

// Regression test for PR #5495 A11 fix (CR Finding 2). The A11 fix
// inlined the leak-phrase needle as a JS literal inside the
// `page.evaluate()` closure body because the `page.evaluate(fn, arg)`
// second-arg form does NOT propagate the arg into the browser-side
// closure (empirically verified during A11 RED-GREEN). Without that
// inline, `customContentPhrasePresent` stays `false` forever and the
// LGP-gold disjoint-prompts content guard becomes dead code — and
// because the fake `Page` in `makePageReturning` never executes the
// closure, reverting the inline-needle fix would NOT be caught by any
// other test. This test captures the closure source and asserts the
// inline-needle invariant directly.
describe("D5 tool-rendering-custom-catchall — inline-needle invariant (regression)", () => {
  function findEvaluateCallSource(fnSource: string): string {
    // Locate the `page.evaluate(` call and capture the closure source
    // we hand to it. We use a substring scan rather than a regex because
    // the closure body contains characters (parens, braces, quotes)
    // that would force a full balanced-paren parser to match cleanly.
    const idx = fnSource.indexOf("page.evaluate(");
    expect(idx).toBeGreaterThanOrEqual(0);
    return fnSource.slice(idx);
  }

  it("probeCustomCatchall inlines the leak phrase as a string literal", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const src = mod.probeCustomCatchall.toString();
    const evalCall = findEvaluateCallSource(src);
    // The canonical phrase must appear as a literal inside the closure
    // body. We assert via the exported constant so a renamed/relocated
    // constant still tracks correctly.
    expect(evalCall).toContain(mod.CUSTOM_CATCHALL_CONTENT_PHRASE);
  });

  it("probeCustomCatchall does NOT pass the needle via a page.evaluate second-arg", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const src = mod.probeCustomCatchall.toString();
    // The historical broken form declared a parameter on the closure:
    //   page.evaluate((expectedPhrase?: string) => { ... }, phrase)
    // The fixed form takes no parameters. Asserting on these patterns
    // would re-fail immediately if the fix were reverted.
    expect(src).not.toMatch(/page\.evaluate\(\s*\(\s*expectedPhrase/);
    expect(src).not.toMatch(/page\.evaluate\(\s*\(\s*expectedLeakPhrase/);
    // Defensive: the literal needle inside the closure must NOT be
    // sourced from a captured outer-scope binding (e.g.
    // `const leakPhrase = CUSTOM_CATCHALL_CONTENT_PHRASE;` outside the
    // closure followed by passing it as an arg). The arg-form's call
    // signature was `page.evaluate(fn, leakPhrase)` — assert no second
    // arg is passed to evaluate.
    //
    // The closure used in `probeCustomCatchall` is the LAST `(...) =>`
    // before the trailing `)` of `page.evaluate(...)`. We match the
    // tail of the function source to assert the evaluate call closes
    // with `})` and not `}, <something>)`.
    const tail = src.slice(-200);
    // The closure ends with `});` (no second arg) — not `}, x);` or
    // `}, "...")`.
    expect(tail).toMatch(/\}\s*\)\s*;?\s*\}?\s*$/);
    expect(tail).not.toMatch(/\},\s*[A-Za-z_$"]/);
  });
});

// Regression test for PR #5495 A7 fix (CR Finding 3). The A7 fix
// added the `requireContentPhrase` knob to `validateCustomCatchall`
// (and threaded it through `assertCustomCatchall`). The existing
// tests omitted the third arg and so always exercised the default
// `false` branch — the new leak-detection branch was untested. This
// suite covers the `true` branch end-to-end.
describe("D5 tool-rendering-custom-catchall — requireContentPhrase branch (regression)", () => {
  it("passes when both tool names AND the content phrase are present", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      {
        toolNames: ["get_weather", "get_stock_price"],
        containerCount: 2,
        customContentPhrasePresent: true,
      },
      ["get_weather", "get_stock_price"],
      true,
    );
    expect(result).toBeNull();
  });

  it("fails when the content phrase is absent and the flag is true", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    const result = mod.validateCustomCatchall(
      {
        toolNames: ["get_weather", "get_stock_price"],
        containerCount: 2,
        customContentPhrasePresent: false,
      },
      ["get_weather", "get_stock_price"],
      true,
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(/custom-catchall content phrase/);
    expect(result).toMatch(/leaked default-catchall fixture/);
    // The canonical phrase must appear in the error message.
    expect(result).toContain(mod.CUSTOM_CATCHALL_CONTENT_PHRASE);
  });

  it("fails when customContentPhrasePresent is undefined and flag is true", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    // Pre-A7 fixtures predating the field — absence must be treated as
    // false by the validator (documented behavior).
    const result = mod.validateCustomCatchall(
      {
        toolNames: ["get_weather", "get_stock_price"],
        containerCount: 2,
      },
      ["get_weather", "get_stock_price"],
      true,
    );
    expect(result).not.toBeNull();
    expect(result).toMatch(/custom-catchall content phrase/);
  });

  it("passes when phrase absent BUT requireContentPhrase is false (default)", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    // Confirms the default-branch behavior is preserved: when the flag
    // is false, an absent phrase is NOT a failure.
    const result = mod.validateCustomCatchall(
      {
        toolNames: ["get_weather", "get_stock_price"],
        containerCount: 2,
        customContentPhrasePresent: false,
      },
      ["get_weather", "get_stock_price"],
      false,
    );
    expect(result).toBeNull();
  });

  it("assertCustomCatchall plumbs requireContentPhrase through to the validator", async () => {
    const mod = await import("./d5-tool-rendering-custom-catchall.js");
    // Fake page that returns containers + tool names but NO content
    // phrase. With `requireContentPhrase: true`, the assert must throw
    // with the canonical-phrase error message.
    const page: Page = {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> =>
        ({
          toolNames: ["get_weather", "get_stock_price"],
          containerCount: 2,
          customContentPhrasePresent: false,
        }) as R,
    };
    await expect(
      mod.assertCustomCatchall(page, ["get_weather", "get_stock_price"], {
        requireContentPhrase: true,
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/custom-catchall content phrase/);
  });
});
