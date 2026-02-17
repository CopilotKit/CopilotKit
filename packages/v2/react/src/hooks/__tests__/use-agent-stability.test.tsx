import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { MockStepwiseAgent } from "@/__tests__/utils/test-helpers";
import { useAgent } from "../use-agent";
import {
  CopilotKitCoreRuntimeConnectionStatus,
} from "@copilotkitnext/core";

// Mock the CopilotKitProvider to control copilotkit state directly
vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

/**
 * Tests for useAgent referential stability during runtime connection lifecycle.
 *
 * Bug: useAgent creates multiple ProxiedCopilotRuntimeAgent instances during
 * Disconnected→Connecting→Connected transitions because the useMemo recalculates
 * on every dependency change and creates a new agent each time.
 */
describe("useAgent stability during runtime connection", () => {
  let mockCopilotkit: {
    getAgent: ReturnType<typeof vi.fn>;
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    runtimeTransport: string;
    headers: Record<string, string>;
    agents: Record<string, AbstractAgent>;
  };

  beforeEach(() => {
    mockCopilotkit = {
      getAgent: vi.fn(() => undefined),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      runtimeTransport: "rest",
      headers: {},
      agents: {},
    };

    mockUseCopilotKit.mockReturnValue({
      copilotkit: mockCopilotkit,
      executingToolCallIds: new Set(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should reuse the same provisional agent across re-renders during Disconnected→Connecting", () => {
    const agentInstances: AbstractAgent[] = [];

    function AgentTracker() {
      const { agent } = useAgent({ agentId: "test-agent" });
      if (
        agentInstances.length === 0 ||
        agentInstances[agentInstances.length - 1] !== agent
      ) {
        agentInstances.push(agent);
      }
      return <div>{agent.threadId}</div>;
    }

    // Render 1: Disconnected — creates provisional agent
    const { rerender } = render(<AgentTracker />);
    expect(agentInstances.length).toBe(1);
    const provisionalThreadId = agentInstances[0]!.threadId;

    // Render 2: Connecting — should reuse same provisional agent
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    rerender(<AgentTracker />);

    // BUG: Current code creates a new agent instance here (agentInstances.length === 2)
    // FIX: Should still be 1 (same provisional reused)
    expect(agentInstances.length).toBe(1);
    expect(agentInstances[0]!.threadId).toBe(provisionalThreadId);
  });

  it("should reuse provisional agent when headers change during connecting", () => {
    const agentInstances: AbstractAgent[] = [];

    function AgentTracker() {
      const { agent } = useAgent({ agentId: "test-agent" });
      if (
        agentInstances.length === 0 ||
        agentInstances[agentInstances.length - 1] !== agent
      ) {
        agentInstances.push(agent);
      }
      return <div>{agent.threadId}</div>;
    }

    // Render 1: Disconnected
    const { rerender } = render(<AgentTracker />);
    expect(agentInstances.length).toBe(1);

    // Render 2: Connecting
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    rerender(<AgentTracker />);

    // Render 3: Headers change (e.g., auth token set)
    mockCopilotkit.headers = { "X-CopilotCloud-Public-Api-Key": "test-key" };
    rerender(<AgentTracker />);

    // Render 4: Another minor change
    mockCopilotkit.headers = {
      "X-CopilotCloud-Public-Api-Key": "test-key",
      "X-Custom": "value",
    };
    rerender(<AgentTracker />);

    // BUG: Current code creates a new agent on each re-render (agentInstances.length >= 3)
    // FIX: Should still be 1 (same provisional reused throughout connecting phase)
    expect(agentInstances.length).toBe(1);
  });

  it("should keep the same agent instance across the full Disconnected→Connected lifecycle", () => {
    const agentInstances: AbstractAgent[] = [];

    function AgentTracker() {
      const { agent } = useAgent({ agentId: "test-agent" });
      if (
        agentInstances.length === 0 ||
        agentInstances[agentInstances.length - 1] !== agent
      ) {
        agentInstances.push(agent);
      }
      return <div>{agent.threadId}</div>;
    }

    // Phase 1: Disconnected — provisional created
    const { rerender } = render(<AgentTracker />);
    const provisionalThreadId = agentInstances[0]!.threadId;

    // Phase 2: Connecting
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    rerender(<AgentTracker />);

    // Phase 3: Headers change during connecting
    mockCopilotkit.headers = { "X-Auth": "token" };
    rerender(<AgentTracker />);

    // Phase 4: Connected — registered agent now available
    const registeredAgent = new MockStepwiseAgent();
    registeredAgent.agentId = "test-agent";
    registeredAgent.description = "Agent from /info";

    mockCopilotkit.getAgent.mockReturnValue(registeredAgent);
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockCopilotkit.agents = { "test-agent": registeredAgent };
    rerender(<AgentTracker />);

    // Phase 5: agents notification (separate re-render in real app)
    rerender(<AgentTracker />);

    // The provisional is kept and updated in-place — same reference throughout.
    // This means CopilotChat's connect effect fires exactly once (on mount).
    expect(agentInstances.length).toBe(1);
    // ThreadId is stable across all phases
    expect(agentInstances[0]!.threadId).toBe(provisionalThreadId);
    // Description was synced from the registered agent
    expect(agentInstances[0]!.description).toBe("Agent from /info");
  });

  it("should return local dev agents directly without a provisional", () => {
    const localAgent = new MockStepwiseAgent();
    localAgent.agentId = "local-agent";

    // Simulate agents__unsafe_dev_only: no runtimeUrl, agent found immediately
    mockCopilotkit.runtimeUrl = undefined;
    mockCopilotkit.getAgent.mockReturnValue(localAgent);
    mockCopilotkit.agents = { "local-agent": localAgent };

    const agentInstances: AbstractAgent[] = [];

    function AgentTracker() {
      const { agent } = useAgent({ agentId: "local-agent" });
      if (
        agentInstances.length === 0 ||
        agentInstances[agentInstances.length - 1] !== agent
      ) {
        agentInstances.push(agent);
      }
      return <div>{agent.threadId}</div>;
    }

    const { rerender } = render(<AgentTracker />);
    rerender(<AgentTracker />);

    // Local agent is returned directly — exactly 1 instance, the original
    expect(agentInstances.length).toBe(1);
    expect(agentInstances[0]).toBe(localAgent);
  });
});
