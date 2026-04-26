import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

// Module side-effect: importing the script populates the registry. The
// import runs ONCE per test process (vitest caches ESM modules), so
// registration assertions live in a `beforeAll` that clears the
// registry, performs the import, and snapshots both the script object
// and exported helpers for the rest of the suite.
//
// Production execution path matches: `e2e-deep.ts`'s defaultScriptLoader
// `await import(...)`s every `d5-*` file exactly once at boot, then the
// registry is read for the lifetime of the driver.

let scriptModule: typeof import("./d5-mcp-subagents.js");

describe("D5 mcp-subagents script — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-mcp-subagents.js");
  });

  it("registers under both `mcp-apps` and `subagents` feature types", () => {
    const mcpAppsScript = getD5Script("mcp-apps");
    const subagentsScript = getD5Script("subagents");

    expect(mcpAppsScript).toBeDefined();
    expect(subagentsScript).toBeDefined();
    // Same script object claims both feature types — registration
    // collisions would have thrown.
    expect(mcpAppsScript).toBe(subagentsScript);
    expect(D5_REGISTRY.size).toBe(2);
  });

  it("references the canonical fixture file", () => {
    const script = getD5Script("mcp-apps");
    expect(script?.fixtureFile).toBe("mcp-subagents.json");
  });

  it("registers the preNavigateRoute override on the registry entry", () => {
    const script = getD5Script("mcp-apps");
    expect(script?.preNavigateRoute).toBeDefined();
    expect(script!.preNavigateRoute!("mcp-apps")).toBe("/demos/subagents");
    expect(script!.preNavigateRoute!("subagents")).toBe("/demos/subagents");
  });
});

describe("D5 mcp-subagents script — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-mcp-subagents.js");
    }
  });

  it("returns one turn matching the fixture's user prompt", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "subagents",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };

    const turns = scriptModule.buildTurns(ctx);

    expect(turns).toHaveLength(1);
    // Verbatim match against the fixture's `userMessage` matcher in
    // mcp-subagents.json — any drift here routes the request to the
    // live model rather than the recorded chain.
    expect(turns[0]!.input).toBe(
      "Research the benefits of remote work and draft a one-paragraph summary",
    );
    // The sole turn carries an assertion callback that scrapes the
    // settled reply and verifies chain fragments. Presence is the
    // contract; behaviour is exercised in dedicated tests below.
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("shape is identical for `mcp-apps` and `subagents` feature types", () => {
    const baseCtx = {
      integrationSlug: "langgraph-python",
      baseUrl: "https://showcase-langgraph-python.example.com",
    };

    const mcpTurns = scriptModule.buildTurns({
      ...baseCtx,
      featureType: "mcp-apps",
    });
    const subTurns = scriptModule.buildTurns({
      ...baseCtx,
      featureType: "subagents",
    });

    expect(mcpTurns).toHaveLength(subTurns.length);
    expect(mcpTurns[0]!.input).toBe(subTurns[0]!.input);
  });
});

describe("D5 mcp-subagents script — preNavigateRoute", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-mcp-subagents.js");
    }
  });

  it("returns `/demos/subagents` for `mcp-apps`", () => {
    expect(scriptModule.preNavigateRoute("mcp-apps")).toBe("/demos/subagents");
  });

  it("returns `/demos/subagents` for `subagents`", () => {
    expect(scriptModule.preNavigateRoute("subagents")).toBe("/demos/subagents");
  });
});

describe("D5 mcp-subagents assertChainedReply", () => {
  // The assertion scrapes visible page text via `page.evaluate` and
  // checks that fragments unique to each sub-agent's contribution made
  // it into the final reply. We hand in a scripted Page fake (the
  // structural minimal type from conversation-runner.ts) — production
  // callers pass a real Playwright Page transparently.

  function makePageWithText(text: string): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      // The script's assertion calls `page.evaluate(() => document.body.innerText)`.
      // We bypass the real DOM by returning the scripted text verbatim.
      evaluate: async <R>(_fn: () => R): Promise<R> => text as unknown as R,
    };
  }

  it("passes when the reply contains every chain fragment", async () => {
    const mod = await import("./d5-mcp-subagents.js");
    const page = makePageWithText(
      [
        "Here is the summary, after research → drafting → critique:",
        "Remote work returns roughly ten hours a week to employees by",
        "eliminating the commute, and repeated surveys show meaningfully",
        "higher job satisfaction among remote workers. Employers benefit",
        "too: a geographically unbounded talent pool and lower office",
        "overhead. The honest counterweight is that ad-hoc collaboration,",
        "mentorship of junior staff, and cultural cohesion all degrade",
        "without intentional rituals to replace what an office provided",
        "implicitly.",
      ].join(" "),
    );

    await expect(mod.assertChainedReply(page)).resolves.toBeUndefined();
  });

  it("passes when fragments appear regardless of case", async () => {
    const mod = await import("./d5-mcp-subagents.js");
    const page = makePageWithText(
      "TEN HOURS A WEEK ... REMOTE WORKERS ... TALENT POOL ... MENTORSHIP ... CULTURAL COHESION",
    );
    await expect(mod.assertChainedReply(page)).resolves.toBeUndefined();
  });

  it("throws when the reply is missing critique-stage fragments", async () => {
    // Drops "mentorship" and "cultural cohesion" — the critique sub-
    // agent's signature framing. If those are missing we KNOW the
    // chain didn't reach critique_agent, even if research + writing
    // both fired.
    const mod = await import("./d5-mcp-subagents.js");
    const page = makePageWithText(
      "Remote work returns roughly ten hours a week. Surveys cite remote workers and a wider talent pool.",
    );

    await expect(mod.assertChainedReply(page)).rejects.toThrow(/mentorship/);
  });

  it("throws when the reply is empty", async () => {
    const mod = await import("./d5-mcp-subagents.js");
    const page = makePageWithText("");
    await expect(mod.assertChainedReply(page)).rejects.toThrow(
      /missing fragments/,
    );
  });
});
