import type { AbstractAgent } from "@ag-ui/client";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import CreateInterruptHarness from "./create-interrupt-harness.svelte";

describe("createInterrupt", () => {
  it("subscribes to the resolved agent via reactive binding", async () => {
    const agentSubscribe = vi.fn(() => ({ unsubscribe: vi.fn() }));
    const agent = {
      agentId: "test-agent",
      subscribe: agentSubscribe,
      state: {},
      messages: [],
      isRunning: false,
    } as unknown as AbstractAgent;

    let handlers: SubscribeToAgentSubscriber | undefined;
    const unsubscribe = vi.fn();

    const core = {
      agents: { "test-agent": agent },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: undefined,
      runtimeTransport: "auto",
      headers: {},
      getAgent: vi.fn(() => agent),
      subscribeToAgentWithOptions: vi.fn(
        (_a: AbstractAgent, nextHandlers: SubscribeToAgentSubscriber) => {
          handlers = nextHandlers;
          return { unsubscribe };
        },
      ),
      setInterruptState: vi.fn(),
    } as unknown as CopilotKitCoreSvelte;

    const context = {
      copilotkit: core,
      executingToolCallIds: new Set<string>(),
      agents: core.agents,
      runtimeConnectionStatus: core.runtimeConnectionStatus,
      runtimeUrl: core.runtimeUrl,
      runtimeTransport: core.runtimeTransport,
      headers: core.headers,
      threadEndpoints: undefined,
      intelligence: undefined,
      licenseStatus: undefined,
    } as CopilotKitContextValue;

    const view = render(CreateInterruptHarness, { props: { context } });

    // When the agent resolves, createInterrupt's $effect reads
    // agentHandle.agent and calls agent.subscribe(...)
    await waitFor(() => {
      expect(agentSubscribe).toHaveBeenCalledTimes(1);
    });

    view.unmount();
  });

  it("no-ops when no agent is registered", async () => {
    const core = {
      agents: {},
      runtimeConnectionStatus:
        CopilotKitCoreRuntimeConnectionStatus.Disconnected,
      runtimeUrl: "https://runtime.local",
      runtimeTransport: "auto",
      headers: {},
      getAgent: vi.fn(() => undefined),
      subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
      setInterruptState: vi.fn(),
    } as unknown as CopilotKitCoreSvelte;

    const context = {
      copilotkit: core,
      executingToolCallIds: new Set<string>(),
      agents: core.agents,
      runtimeConnectionStatus: core.runtimeConnectionStatus,
      runtimeUrl: core.runtimeUrl,
      runtimeTransport: core.runtimeTransport,
      headers: core.headers,
      threadEndpoints: undefined,
      intelligence: undefined,
      licenseStatus: undefined,
    } as CopilotKitContextValue;

    const view = render(CreateInterruptHarness, { props: { context } });

    await waitFor(() => {
      expect(view.getByTestId("interrupt-state").textContent).toBe(
        '{"hasInterrupt":false,"interrupt":null}',
      );
      expect(core.setInterruptState).toHaveBeenCalledWith(null);
    });

    view.unmount();
  });
});
