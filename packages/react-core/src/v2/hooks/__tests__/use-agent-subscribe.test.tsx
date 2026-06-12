import React, { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { useCopilotKit } from "../../context";
import { useAgent } from "../use-agent";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

// Mock the CopilotKit context to control copilotkit state directly
vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * Issue #5000: subscribing to the agent returned by useAgent() in a mount
 * effect threw "Cannot read properties of undefined (reading 'subscribers')"
 * when `subscribe` was invoked detached from the agent — the natural shape of
 * several React patterns (destructuring, `useSyncExternalStore(agent.subscribe, ...)`).
 *
 * The agent useAgent returns on first render (a provisional
 * ProxiedCopilotRuntimeAgent while the runtime is connecting) must be
 * subscribable immediately, including via a detached reference.
 */
describe("useAgent subscribe on mount (issue #5000)", () => {
  beforeEach(() => {
    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        getAgent: vi.fn(() => undefined),
        runtimeUrl: "http://localhost:3000/api/copilotkit",
        runtimeConnectionStatus:
          CopilotKitCoreRuntimeConnectionStatus.Connecting,
        runtimeTransport: "rest",
        headers: {},
        agents: {},
        subscribeToAgentWithOptions: (
          agent: AbstractAgent,
          subscriber: AgentSubscriber,
        ) => agent.subscribe(subscriber),
      },
      executingToolCallIds: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderSubscriber(
    subscribeFromEffect: (agent: AbstractAgent) => void,
  ): { effectError: Error | null } {
    const result: { effectError: Error | null } = { effectError: null };

    function AgentSubscriberProbe() {
      const { agent } = useAgent({ agentId: "test-agent" });
      useEffect(() => {
        try {
          subscribeFromEffect(agent);
        } catch (err) {
          result.effectError = err as Error;
        }
      }, [agent]);
      return <div>ok</div>;
    }

    render(<AgentSubscriberProbe />);
    return result;
  }

  it("supports the issue's literal repro: agent.subscribe() in a useEffect on first render", () => {
    const { effectError } = renderSubscriber((agent) => {
      const sub = agent.subscribe({ onRunFinalized: vi.fn() });
      sub.unsubscribe();
    });

    expect(effectError).toBeNull();
  });

  it("supports subscribe invoked detached from the agent", () => {
    const { effectError } = renderSubscriber((agent) => {
      const { subscribe } = agent;
      const sub = subscribe({ onRunFinalized: vi.fn() });
      sub.unsubscribe();
    });

    expect(effectError).toBeNull();
  });
});
