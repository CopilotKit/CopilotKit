import { describe, it, expect } from "vitest";
import { CopilotKitCore } from "../core";
import { ɵcreateMemoryStore } from "../memories";
import { MockAgent } from "./test-utils";

/**
 * Pins the integration contract between `CopilotKitCore.onAgentsChanged`
 * and the memory-store registry.
 *
 * Background: when `agents` change, the core auto-unregisters memory stores
 * for any agentId that has been removed. The "previously had" guard exists
 * so that the FIRST onAgentsChanged({ agents: {} }) notification — which
 * fires for published cores BEFORE the published agents are merged in —
 * does not rip out a store that a consumer just registered.
 */

describe("CopilotKitCore — onAgentsChanged auto-unregister (memory stores)", () => {
  it("unregisters a memory store when its agent is removed from agents", async () => {
    // Start with agent-1 registered. Add a memory store for it. Then remove
    // agent-1 and confirm the store is auto-unregistered.
    const agent1 = new MockAgent({ agentId: "agent-1" });
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { "agent-1": agent1 as never },
    });

    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);
    expect(core.getMemoryStore("agent-1")).toBe(store);

    // Removing agent-1 triggers onAgentsChanged({ agents: {} }) — but agent-1
    // WAS in the previous snapshot, so the auto-unregister must fire here.
    core.removeAgent__unsafe_dev_only("agent-1");
    // Subscriber notification is fire-and-forget; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(core.getMemoryStore("agent-1")).toBeUndefined();
  });

  it("does NOT unregister a freshly-registered store on the FIRST empty-agents notification", async () => {
    // Reproduces the published-core race: the core is created with no agents
    // (agents are populated asynchronously), a consumer registers a memory
    // store immediately, and the very first onAgentsChanged({ agents: {} })
    // notification arrives. Without the "previously had" guard, that empty
    // notification would rip out the freshly-registered store.
    const core = new CopilotKitCore({});

    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);

    // Trigger an onAgentsChanged({ agents: {} }) notification — this models
    // the initial empty-agents notification a published core receives before
    // its agents are merged in.
    core.setAgents__unsafe_dev_only({});
    await Promise.resolve();
    await Promise.resolve();

    // The store must survive — agent-1 was never in the previous snapshot,
    // so there is no transition from "had" to "missing" and nothing to
    // unregister.
    expect(core.getMemoryStore("agent-1")).toBe(store);
  });

  it("unregisters on the SECOND notification when agent appears then disappears", async () => {
    // Add agent-1, register a store, then remove agent-1. This time the
    // previous snapshot DID contain agent-1, so the auto-unregister must
    // fire.
    const agent1 = new MockAgent({ agentId: "agent-1" });
    const core = new CopilotKitCore({});

    core.addAgent__unsafe_dev_only({ id: "agent-1", agent: agent1 as never });
    const store = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store);

    core.removeAgent__unsafe_dev_only("agent-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(core.getMemoryStore("agent-1")).toBeUndefined();
  });

  it("retains the store for an agent that is still present", async () => {
    // Two agents: agent-1 and agent-2 both have stores. Removing agent-1
    // must not touch agent-2's store.
    const agent1 = new MockAgent({ agentId: "agent-1" });
    const agent2 = new MockAgent({ agentId: "agent-2" });
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: {
        "agent-1": agent1 as never,
        "agent-2": agent2 as never,
      },
    });

    const store1 = ɵcreateMemoryStore();
    const store2 = ɵcreateMemoryStore();
    core.registerMemoryStore("agent-1", store1);
    core.registerMemoryStore("agent-2", store2);

    core.removeAgent__unsafe_dev_only("agent-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(core.getMemoryStore("agent-1")).toBeUndefined();
    expect(core.getMemoryStore("agent-2")).toBe(store2);
  });
});
