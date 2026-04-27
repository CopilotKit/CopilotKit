import { defineComponent, ref, watchEffect, nextTick } from "vue";
import type { Ref } from "vue";
import { render, cleanup } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { MockStepwiseAgent } from "../../__tests__/utils/test-helpers";
import { useAgent } from "../use-agent";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";

// Mock the CopilotKitProvider to control copilotkit state directly
vi.mock("../../providers/useCopilotKit", () => ({
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
  type MockCopilotkit = {
    getAgent: ReturnType<typeof vi.fn>;
    runtimeUrl: string | undefined;
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
    runtimeTransport: string;
    headers: Record<string, string>;
    agents: Record<string, AbstractAgent>;
    // Added after the hook moved to consume the shared core API. Mocks only
    // need a no-op subscription object here; stability/ref-identity behavior
    // is orthogonal to subscribe internals.
    subscribeToAgentWithOptions: ReturnType<typeof vi.fn>;
  };

  let mockCopilotkit: MockCopilotkit;
  let copilotkitRef: Ref<MockCopilotkit>;

  beforeEach(() => {
    copilotkitRef = ref({
      getAgent: vi.fn(() => undefined),
      runtimeUrl: "http://localhost:3000/api/copilotkit",
      runtimeConnectionStatus:
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      runtimeTransport: "rest",
      headers: {},
      agents: {},
      subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    });
    mockCopilotkit = copilotkitRef.value;

    mockUseCopilotKit.mockReturnValue({
      copilotkit: copilotkitRef,
      executingToolCallIds: ref(new Set()),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("should reuse the same provisional agent across re-renders during Disconnected→Connecting", async () => {
    const agentInstances: AbstractAgent[] = [];

    const AgentTracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });

        watchEffect(() => {
          if (
            agentInstances.length === 0 ||
            agentInstances[agentInstances.length - 1] !== agent.value
          ) {
            agentInstances.push(agent.value);
          }
        });

        return { agent };
      },
      template: `<div>{{ agent.threadId }}</div>`,
    });

    // Render 1: Disconnected — creates provisional agent
    const { rerender } = render(AgentTracker, { props: { tick: 0 } });
    await nextTick();
    expect(agentInstances.length).toBe(1);
    const provisionalThreadId = agentInstances[0]!.threadId;

    // Render 2: Connecting — should reuse same provisional agent
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    await rerender({ tick: 1 });
    await nextTick();

    // BUG: Current code creates a new agent instance here (agentInstances.length === 2)
    // FIX: Should still be 1 (same provisional reused)
    expect(agentInstances.length).toBe(1);
    expect(agentInstances[0]!.threadId).toBe(provisionalThreadId);
  });

  it("should reuse provisional agent when headers change during connecting", async () => {
    const agentInstances: AbstractAgent[] = [];

    const AgentTracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });

        watchEffect(() => {
          if (
            agentInstances.length === 0 ||
            agentInstances[agentInstances.length - 1] !== agent.value
          ) {
            agentInstances.push(agent.value);
          }
        });

        return { agent };
      },
      template: `<div>{{ agent.threadId }}</div>`,
    });

    // Render 1: Disconnected
    const { rerender } = render(AgentTracker, { props: { tick: 0 } });
    await nextTick();
    expect(agentInstances.length).toBe(1);

    // Render 2: Connecting
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    await rerender({ tick: 1 });
    await nextTick();

    // Render 3: Headers change (e.g., auth token set)
    mockCopilotkit.headers = { "X-CopilotCloud-Public-Api-Key": "test-key" };
    await rerender({ tick: 2 });
    await nextTick();

    // Render 4: Another minor change
    mockCopilotkit.headers = {
      "X-CopilotCloud-Public-Api-Key": "test-key",
      "X-Custom": "value",
    };
    await rerender({ tick: 3 });
    await nextTick();

    // BUG: Current code creates a new agent on each re-render (agentInstances.length >= 3)
    // FIX: Should still be 1 (same provisional reused throughout connecting phase)
    expect(agentInstances.length).toBe(1);
  });

  it("should keep the same agent instance across the full Disconnected→Connected lifecycle", async () => {
    const agentInstances: AbstractAgent[] = [];

    const AgentTracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup() {
        const { agent } = useAgent({ agentId: "test-agent" });

        watchEffect(() => {
          if (
            agentInstances.length === 0 ||
            agentInstances[agentInstances.length - 1] !== agent.value
          ) {
            agentInstances.push(agent.value);
          }
        });

        return { agent };
      },
      template: `<div>{{ agent.threadId }}</div>`,
    });

    // Phase 1: Disconnected — provisional created
    const { rerender } = render(AgentTracker, { props: { tick: 0 } });
    await nextTick();
    const provisionalThreadId = agentInstances[0]!.threadId;

    // Phase 2: Connecting
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connecting;
    await rerender({ tick: 1 });
    await nextTick();

    // Phase 3: Headers change during connecting
    mockCopilotkit.headers = { "X-Auth": "token" };
    await rerender({ tick: 2 });
    await nextTick();

    // Phase 4: Connected — registered agent now available
    const registeredAgent = new MockStepwiseAgent();
    registeredAgent.agentId = "test-agent";
    registeredAgent.description = "Agent from /info";

    mockCopilotkit.getAgent.mockReturnValue(registeredAgent);
    mockCopilotkit.runtimeConnectionStatus =
      CopilotKitCoreRuntimeConnectionStatus.Connected;
    mockCopilotkit.agents = { "test-agent": registeredAgent };
    await rerender({ tick: 3 });
    await nextTick();

    // Phase 5: agents notification (separate re-render in real app)
    await rerender({ tick: 4 });
    await nextTick();

    // 2 instances: 1 provisional (Disconnected/Connecting) + 1 registered (Connected).
    // The provisional is stable across all pre-connection renders.
    // CopilotChat's connect guard ensures connect fires only once (when Connected),
    // so the agent reference change doesn't cause a duplicate connect.
    expect(agentInstances.length).toBe(2);
    // First instance was the provisional
    expect(agentInstances[0]!.threadId).toBe(provisionalThreadId);
    // Second instance is the registered agent
    expect(agentInstances[1]).toBe(registeredAgent);
  });

  it("should return local dev agents directly without a provisional", async () => {
    const localAgent = new MockStepwiseAgent();
    localAgent.agentId = "local-agent";

    // Simulate agents__unsafe_dev_only: no runtimeUrl, agent found immediately
    mockCopilotkit.runtimeUrl = undefined;
    mockCopilotkit.getAgent.mockReturnValue(localAgent);
    mockCopilotkit.agents = { "local-agent": localAgent };

    const agentInstances: AbstractAgent[] = [];

    const AgentTracker = defineComponent({
      props: {
        tick: { type: Number, required: true },
      },
      setup() {
        const { agent } = useAgent({ agentId: "local-agent" });

        watchEffect(() => {
          if (
            agentInstances.length === 0 ||
            agentInstances[agentInstances.length - 1] !== agent.value
          ) {
            agentInstances.push(agent.value);
          }
        });

        return { agent };
      },
      template: `<div>{{ agent.threadId }}</div>`,
    });

    const { rerender } = render(AgentTracker, { props: { tick: 0 } });
    await rerender({ tick: 1 });
    await nextTick();

    // Local agent is returned directly — exactly 1 instance, the original
    expect(agentInstances.length).toBe(1);
    expect(agentInstances[0]).toBe(localAgent);
  });
});
