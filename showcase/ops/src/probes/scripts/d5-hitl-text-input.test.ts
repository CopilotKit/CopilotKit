/**
 * Tests for `d5-hitl-text-input.ts`.
 *
 * Mirrors `d5-hitl-approve-deny.test.ts` — see that file for the
 * rationale on registry side-effect handling and Page mocking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  __clearD5RegistryForTesting,
  D5_REGISTRY,
} from "../helpers/d5-registry.js";

describe("d5-hitl-text-input script", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("registers under the hitl-text-input feature type with the right fixture file", async () => {
    const mod = await import("./d5-hitl-text-input.js");
    const script = mod.__d5HitlTextInputScript;

    expect(script.featureTypes).toEqual(["hitl-text-input"]);
    expect(script.fixtureFile).toBe("hitl-text-input.json");
    expect(script.preNavigateRoute?.("hitl-text-input")).toBe(
      "/demos/hitl-in-chat",
    );
  });

  it("buildTurns produces a single turn whose input matches the fixture user message", async () => {
    const mod = await import("./d5-hitl-text-input.js");
    const script = mod.__d5HitlTextInputScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-text-input",
      baseUrl: "https://example.test",
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("Book a 30-minute onboarding call for Alice");
    expect(turns[0]!.assertions).toBeTypeOf("function");
  });

  it("assertion picks a slot and passes when the follow-up message contains 'Alice'", async () => {
    const mod = await import("./d5-hitl-text-input.js");
    const script = mod.__d5HitlTextInputScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-text-input",
      baseUrl: "https://example.test",
    });

    const calls: { method: string; selector: string }[] = [];
    let evaluateCount = 0;
    const page = {
      async waitForSelector(selector: string) {
        calls.push({ method: "waitForSelector", selector });
      },
      async fill() {},
      async press() {},
      async click(selector: string) {
        calls.push({ method: "click", selector });
      },
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Booked Alice's onboarding call for the time you selected." as unknown as R;
      },
    };

    await turns[0]!.assertions!(page);
    // Time-picker card was probed AND a slot button was clicked.
    expect(
      calls.some(
        (c) =>
          c.method === "waitForSelector" && c.selector.includes("time-picker"),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.method === "click")).toBe(true);
  });

  it("assertion throws when the follow-up message is missing 'Alice'", async () => {
    const mod = await import("./d5-hitl-text-input.js");
    const script = mod.__d5HitlTextInputScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-text-input",
      baseUrl: "https://example.test",
    });

    let evaluateCount = 0;
    const page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Booked." as unknown as R;
      },
    };

    await expect(turns[0]!.assertions!(page)).rejects.toThrow(/missing token/);
  });
});

describe("d5-hitl-text-input registry side-effect", () => {
  it("populates the registry with the feature type after import", async () => {
    __clearD5RegistryForTesting();
    const mod = await import("./d5-hitl-text-input.js");
    if (!D5_REGISTRY.has("hitl-text-input")) {
      const { registerD5Script } = await import("../helpers/d5-registry.js");
      registerD5Script(mod.__d5HitlTextInputScript);
    }
    expect(D5_REGISTRY.has("hitl-text-input")).toBe(true);
    const entry = D5_REGISTRY.get("hitl-text-input");
    expect(entry?.fixtureFile).toBe("hitl-text-input.json");
  });
});
