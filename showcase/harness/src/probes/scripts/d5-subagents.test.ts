import { describe, it, expect, beforeAll } from "vitest";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

let scriptModule: typeof import("./d5-subagents.js");

describe("D5 subagents script — registration", () => {
  beforeAll(async () => {
    __clearD5RegistryForTesting();
    scriptModule = await import("./d5-subagents.js");
  });

  it("registers under `subagents` feature type only", () => {
    const script = getD5Script("subagents");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["subagents"]);
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("references the canonical fixture file", () => {
    const script = getD5Script("subagents");
    expect(script?.fixtureFile).toBe("mcp-subagents.json");
  });

  it("does NOT register a preNavigateRoute (defaults to /demos/subagents)", () => {
    const script = getD5Script("subagents");
    expect(script?.preNavigateRoute).toBeUndefined();
  });
});

describe("D5 subagents script — buildTurns", () => {
  beforeAll(async () => {
    if (!scriptModule) {
      __clearD5RegistryForTesting();
      scriptModule = await import("./d5-subagents.js");
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
    expect(turns[0]!.input).toBe(scriptModule.USER_PROMPT);
    expect(typeof turns[0]!.assertions).toBe("function");
  });
});

describe("D5 subagents validateSubagentsSnapshot", () => {
  it("passes when all 3 cards present once and no boilerplate", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 1,
      },
      text: "remote work returns roughly ten hours a week to employees",
    });
    expect(result).toBeNull();
  });

  it("fails when researcher card is missing", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 0,
        "subagent-card-writer": 1,
        "subagent-card-critic": 1,
      },
      text: "some real reply",
    });
    expect(result).toMatch(/subagent-card-researcher/);
  });

  it("fails when writer card is missing", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 0,
        "subagent-card-critic": 1,
      },
      text: "some real reply",
    });
    expect(result).toMatch(/subagent-card-writer/);
  });

  it("fails when critic card is missing", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 0,
      },
      text: "some real reply",
    });
    expect(result).toMatch(/subagent-card-critic/);
  });

  it("fails when critic ran more than once (loop regression)", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 2,
      },
      text: "some real reply",
    });
    expect(result).toMatch(/critic ran more than once/);
  });

  it("fails when page text still shows boilerplate", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 1,
      },
      text: "no messages yet — start a conversation",
    });
    expect(result).toMatch(/boilerplate marker/);
  });
});

describe("D5 subagents assertSubagentsChain", () => {
  function makePageReturning(snap: unknown): Page {
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => snap as R,
    };
  }

  function makePageReturningSequence(snaps: unknown[]): Page {
    let i = 0;
    return {
      waitForSelector: async () => undefined,
      fill: async () => undefined,
      press: async () => undefined,
      evaluate: async <R>(_fn: () => R): Promise<R> => {
        const snap = snaps[Math.min(i, snaps.length - 1)];
        i++;
        return snap as R;
      },
    };
  }

  it("passes when the snapshot satisfies all checks (and re-snapshot is also valid)", async () => {
    const mod = await import("./d5-subagents.js");
    const page = makePageReturning({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 1,
      },
      text: "real reply with substance",
    });
    // dwellMs=0 keeps the post-pass re-snapshot fast — we still hit
    // both `evaluate` calls because the same stable snapshot is
    // returned twice.
    await expect(
      mod.assertSubagentsChain(page, 50, 0),
    ).resolves.toBeUndefined();
  });

  it("throws with the validation error when the snapshot fails", async () => {
    const mod = await import("./d5-subagents.js");
    const page = makePageReturning({
      counts: {
        "subagent-card-researcher": 0,
        "subagent-card-writer": 0,
        "subagent-card-critic": 0,
      },
      text: "",
    });
    await expect(mod.assertSubagentsChain(page, 30, 0)).rejects.toThrow(
      /subagent-card-researcher/,
    );
  });

  it("fails when the chain destabilises during the dwell window (critic loop appears post-pass)", async () => {
    // First snapshot passes (1 critic), second snapshot has 2 critics
    // — exactly the regression the dwell-and-recheck guards against.
    const mod = await import("./d5-subagents.js");
    const page = makePageReturningSequence([
      {
        counts: {
          "subagent-card-researcher": 1,
          "subagent-card-writer": 1,
          "subagent-card-critic": 1,
        },
        text: "real reply with substance",
      },
      {
        counts: {
          "subagent-card-researcher": 1,
          "subagent-card-writer": 1,
          "subagent-card-critic": 2,
        },
        text: "real reply with substance",
      },
    ]);
    await expect(mod.assertSubagentsChain(page, 50, 5)).rejects.toThrow(
      /destabilised during/,
    );
  });

  it("flags the empty-sub-agent sentinel as boilerplate", async () => {
    const mod = await import("./d5-subagents.js");
    const result = mod.validateSubagentsSnapshot({
      counts: {
        "subagent-card-researcher": 1,
        "subagent-card-writer": 1,
        "subagent-card-critic": 1,
      },
      // Lower-cased to match the probe's `text.toLowerCase()` snapshot.
      text: "researcher: <sub-agent produced no output>",
    });
    expect(result).toMatch(/boilerplate marker/);
  });
});

describe("D5 subagents — exported testid set", () => {
  it("matches the Phase-1D contract", async () => {
    const mod = await import("./d5-subagents.js");
    expect([...mod.SUBAGENT_CARD_TESTIDS]).toEqual([
      "subagent-card-researcher",
      "subagent-card-writer",
      "subagent-card-critic",
    ]);
  });
});
