import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type { ChannelAgentRouteContext } from "./channel-agent.js";

/**
 * Task 2 migration guard. The real assertions are COMPILE-TIME: the four
 * supported binding modes must type-check, and the removed per-thread factory
 * must be rejected (validated by `tsc` / check-types, not the vitest runtime).
 * The runtime bodies additionally confirm construction does not throw for any
 * accepted mode.
 */
describe("Channel agent binding migration (Task 2)", () => {
  it("accepts the four supported binding modes", () => {
    // 1. Fixed inline agent.
    createChannel({ name: "inline", agent: new FakeAgent() });
    // 2. Named Runtime agent.
    createChannel({ name: "named", agent: "billing" });
    // 3. Router selecting a named Runtime agent per turn.
    createChannel({
      name: "routed",
      agent: (ctx: ChannelAgentRouteContext) =>
        ctx.user?.id === "travis" ? "travis" : "default",
    });
    // 4. Omitted → the Runtime agent named "default".
    createChannel({ name: "defaulted" });

    expect(true).toBe(true);
  });

  it("rejects the removed per-thread agent factory at compile time", () => {
    createChannel({
      name: "old-factory",
      // @ts-expect-error - the old `(threadId) => AbstractAgent` factory is
      // removed; a router must return a Runtime agent NAME (string), never an
      // agent object.
      agent: (threadId: string) => new FakeAgent(),
    });

    expect(true).toBe(true);
  });
});
