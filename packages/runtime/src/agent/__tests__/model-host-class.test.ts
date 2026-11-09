/**
 * The SSE layer reads `modelHostClass` from any agent, without importing
 * BuiltInAgent, and puts it on telemetry. A TanStack AI adapter keeps its
 * base URL private and a factory owns its own LLM call, so every BuiltInAgent
 * reports `"unknown"`.
 */
import { describe, expect, it } from "vitest";
import { fakeText } from "@tanstack/ai/testing";
import { BuiltInAgent } from "../index";

describe("BuiltInAgent.modelHostClass", () => {
  it.each([
    ["a classic agent", () => new BuiltInAgent({ model: fakeText() })],
    [
      "a factory agent",
      () =>
        new BuiltInAgent({
          type: "custom",
          // Never invoked: constructing the agent is the whole test.
          factory: async function* () {},
        }),
    ],
  ])("is unknown for %s", (_case, create) => {
    expect(create().modelHostClass).toBe("unknown");
  });
});
