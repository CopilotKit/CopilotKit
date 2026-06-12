import { describe, it, expect, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

/**
 * Issue #5000: `agent.subscribe()` is a prototype method, so holding a
 * detached reference to it (destructuring, passing it as a callback, e.g.
 * `useSyncExternalStore(agent.subscribe, ...)`) invokes it with
 * `this === undefined` and throws
 * "Cannot read properties of undefined (reading 'subscribers')".
 *
 * These React patterns are common enough that the agents CopilotKit hands
 * out must keep `subscribe` callable without its receiver.
 */
describe("ProxiedCopilotRuntimeAgent detached subscribe (issue #5000)", () => {
  function createAgent() {
    return new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/api",
      agentId: "test-agent",
      transport: "rest",
      runtimeMode: "pending",
    });
  }

  it("registers the subscriber when subscribe is invoked detached from the agent", () => {
    const agent = createAgent();
    const { subscribe } = agent;
    const onRunFinalized = vi.fn();

    expect(() => subscribe({ onRunFinalized })).not.toThrow();
    expect(agent.subscribers).toContainEqual({ onRunFinalized });
  });

  it("unsubscribe returned by a detached subscribe call removes the subscriber", () => {
    const agent = createAgent();
    const { subscribe } = agent;
    const subscriber = { onRunFinalized: vi.fn() };

    const subscription = subscribe(subscriber);
    subscription.unsubscribe();

    expect(agent.subscribers).not.toContain(subscriber);
  });
});
