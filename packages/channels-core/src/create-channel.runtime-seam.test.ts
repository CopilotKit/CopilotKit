import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type { ChannelAgentRouteContext } from "./channel-agent.js";

/**
 * The `ɵruntime` seam (Task 8): the Runtime reads a Channel's declared agent
 * binding + concurrency policy through this internal, undocumented surface so
 * it can compile the Channel into a RuntimeChannelBinding. It is NOT part of the
 * public Channel API (A6).
 */
describe("Channel ɵruntime seam", () => {
  it("exposes an inline agent binding", () => {
    const agent = new FakeAgent();
    const channel = createChannel({ name: "inline", agent });
    expect(channel.ɵruntime.agentBinding).toBe(agent);
  });

  it("exposes a named agent binding", () => {
    const channel = createChannel({ name: "named", agent: "billing" });
    expect(channel.ɵruntime.agentBinding).toBe("billing");
  });

  it("exposes a router agent binding", () => {
    const router = (ctx: ChannelAgentRouteContext) =>
      ctx.user?.id === "travis" ? "travis" : "default";
    const channel = createChannel({ name: "routed", agent: router });
    expect(channel.ɵruntime.agentBinding).toBe(router);
  });

  it("leaves the binding undefined when omitted (default agent)", () => {
    const channel = createChannel({ name: "defaulted" });
    expect(channel.ɵruntime.agentBinding).toBeUndefined();
  });

  it("exposes the declared concurrency policy", () => {
    const channel = createChannel({
      name: "queued",
      concurrency: { onConcurrent: "queue" },
    });
    expect(channel.ɵruntime.concurrency).toEqual({ onConcurrent: "queue" });
  });

  it("leaves concurrency undefined when omitted", () => {
    const channel = createChannel({ name: "plain" });
    expect(channel.ɵruntime.concurrency).toBeUndefined();
  });
});
