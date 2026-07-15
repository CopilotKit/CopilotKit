import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunHandler } from "../run-handler";
import type { CopilotKitCore } from "../core";

function createRunHandler(): RunHandler {
  return new RunHandler({} as CopilotKitCore);
}

describe("RunHandler capability toggle", () => {
  it("omits a tool from buildFrontendTools once disabled via setToolEnabled", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      {
        name: "chart",
        description: "renders a chart",
        parameters: z.object({}),
      },
      { name: "map", description: "renders a map", parameters: z.object({}) },
    ]);

    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "chart",
      "map",
    ]);

    runHandler.setToolEnabled("map", false);

    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "chart",
    ]);
    expect(runHandler.isToolEnabled("map")).toBe(false);
    expect(runHandler.isToolEnabled("chart")).toBe(true);
  });

  it("re-enables a tool via setToolEnabled(true)", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "chart", description: "c" }]);
    runHandler.setToolEnabled("chart", false);
    expect(runHandler.buildFrontendTools()).toHaveLength(0);

    runHandler.setToolEnabled("chart", true);
    expect(runHandler.buildFrontendTools().map((t) => t.name)).toEqual([
      "chart",
    ]);
  });

  it("override survives re-registration (setTools) — keyed by name+agentId, not object identity", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([{ name: "chart", description: "c" }]);
    runHandler.setToolEnabled("chart", false);

    // Simulate a hook re-registering the tool with a fresh object (available resets to default).
    runHandler.setTools([{ name: "chart", description: "c (re-registered)" }]);

    expect(runHandler.isToolEnabled("chart")).toBe(false);
    expect(runHandler.buildFrontendTools()).toHaveLength(0);
  });

  it("distinguishes a global tool from an agent-scoped tool of the same name", () => {
    const runHandler = createRunHandler();
    runHandler.initialize([
      { name: "dup", description: "global" },
      { name: "dup", description: "scoped", agentId: "agentA" },
    ]);

    runHandler.setToolEnabled("dup", false, "agentA");

    const names = runHandler.buildFrontendTools("agentA").map((t) => t.name);
    // The global "dup" (no agentId) is still enabled; the agentA-scoped one is off.
    expect(names).toEqual(["dup"]);
    expect(runHandler.isToolEnabled("dup")).toBe(true);
    expect(runHandler.isToolEnabled("dup", "agentA")).toBe(false);
  });

  it("defaults to enabled for an unknown tool name", () => {
    const runHandler = createRunHandler();
    expect(runHandler.isToolEnabled("never-registered")).toBe(true);
  });

  it("does not collide (name, agentId) pairs that a space separator would merge", () => {
    // capabilityKey joins agentId + name with a NUL byte, which cannot appear
    // in either field. A space separator (the historical bug) would merge these
    // two distinct identities onto one key:
    //   A: agentId "a",   name "b c" -> "a" + " " + "b c" = "a b c"
    //   B: agentId "a b", name "c"   -> "a b" + " " + "c" = "a b c"
    // With a NUL separator they stay distinct, so toggling one must not affect
    // the other.
    const runHandler = createRunHandler();
    runHandler.initialize([
      { name: "b c", description: "tool A", agentId: "a" },
      { name: "c", description: "tool B", agentId: "a b" },
    ]);

    // Disable only tool A (agentId "a").
    runHandler.setToolEnabled("b c", false, "a");

    // Tool A is off; tool B (the space-collision twin) is unaffected.
    expect(runHandler.isToolEnabled("b c", "a")).toBe(false);
    expect(runHandler.isToolEnabled("c", "a b")).toBe(true);

    // buildFrontendTools for A's scope drops A; B still appears in its own scope.
    expect(runHandler.buildFrontendTools("a").map((t) => t.name)).toEqual([]);
    expect(runHandler.buildFrontendTools("a b").map((t) => t.name)).toEqual([
      "c",
    ]);
  });
});
