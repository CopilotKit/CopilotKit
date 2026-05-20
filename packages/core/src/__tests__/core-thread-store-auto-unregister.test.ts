import { describe, it, expect, vi } from "vitest";
import { CopilotKitCore } from "../core";
import type { CopilotKitCoreSubscriber } from "../core/core";
import type { ɵThreadStore } from "../threads";
import { MockAgent } from "./test-utils";

/**
 * Pins the integration contract between `CopilotKitCore.onAgentsChanged`
 * and the thread-store registry.
 *
 * Background: when `agents` change, the core auto-unregisters thread stores
 * for any agentId that has been removed. The "previously had" guard exists
 * so that the FIRST onAgentsChanged({ agents: {} }) notification — which
 * fires for published cores BEFORE the published agents are merged in —
 * does not rip out a store that a consumer (e.g. useThreads) just
 * registered.
 */

function makeStore(id = "store"): ɵThreadStore & { __testId: string } {
  const store: ɵThreadStore = {
    start: vi.fn(),
    stop: vi.fn(),
    setContext: vi.fn(),
    refresh: vi.fn(),
    fetchNextPage: vi.fn(),
    renameThread: vi.fn(),
    archiveThread: vi.fn(),
    deleteThread: vi.fn(),
    getState: vi.fn(),
    select: vi.fn(),
  };
  return Object.assign(store, { __testId: id });
}

describe("CopilotKitCore — onAgentsChanged auto-unregister", () => {
  it("unregisters a thread store when its agent is removed from agents", async () => {
    // Start with agent-1 registered. Add a thread store for it. Then remove
    // agent-1 and confirm the store is auto-unregistered AND the
    // onThreadStoreUnregistered subscriber is notified with the previous
    // store as `prevStore`.
    const agent1 = new MockAgent({ agentId: "agent-1" });
    const core = new CopilotKitCore({
      agents__unsafe_dev_only: { "agent-1": agent1 as never },
    });

    const store = makeStore("agent-1-store");
    core.registerThreadStore("agent-1", store);
    expect(core.getThreadStore("agent-1")).toBe(store);

    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    core.subscribe(subscriber);

    // Removing agent-1 triggers onAgentsChanged({ agents: {} }) — but agent-1
    // WAS in the previous snapshot, so the auto-unregister must fire here.
    core.removeAgent__unsafe_dev_only("agent-1");
    // Subscriber notification is fire-and-forget; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(core.getThreadStore("agent-1")).toBeUndefined();
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", prevStore: store }),
    );
  });

  it("does NOT unregister a freshly-registered store on the FIRST empty-agents notification", async () => {
    // Reproduces the published-core race: the core is created with no agents
    // (agents are populated asynchronously), a consumer registers a thread
    // store immediately, and the very first onAgentsChanged({ agents: {} })
    // notification arrives. Without the "previously had" guard, that empty
    // notification would rip out the freshly-registered store.
    const core = new CopilotKitCore({});

    const store = makeStore("agent-1-store");
    core.registerThreadStore("agent-1", store);

    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    core.subscribe(subscriber);

    // Trigger an onAgentsChanged({ agents: {} }) notification by calling
    // setAgents__unsafe_dev_only({}) — this models the initial empty-agents
    // notification a published core receives before its agents are merged in.
    core.setAgents__unsafe_dev_only({});
    await Promise.resolve();
    await Promise.resolve();

    // The store must survive — agent-1 was never in the previous snapshot,
    // so there is no transition from "had" to "missing" and nothing to
    // unregister.
    expect(core.getThreadStore("agent-1")).toBe(store);
    expect(onUnregistered).not.toHaveBeenCalled();
  });

  it("unregisters on the SECOND notification when agent appears then disappears", async () => {
    // Add agent-1, register a store, then remove agent-1. This time the
    // previous snapshot DID contain agent-1, so the auto-unregister must
    // fire. Complements the "first empty notification" test by exercising
    // the same code path's positive branch.
    const agent1 = new MockAgent({ agentId: "agent-1" });
    const core = new CopilotKitCore({});

    core.addAgent__unsafe_dev_only({ id: "agent-1", agent: agent1 as never });
    const store = makeStore("agent-1-store");
    core.registerThreadStore("agent-1", store);

    const onUnregistered = vi.fn();
    core.subscribe({
      onThreadStoreUnregistered: onUnregistered,
    });

    core.removeAgent__unsafe_dev_only("agent-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(core.getThreadStore("agent-1")).toBeUndefined();
    expect(onUnregistered).toHaveBeenCalledTimes(1);
  });
});
