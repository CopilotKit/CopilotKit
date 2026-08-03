import type { AbstractAgent } from "@ag-ui/client";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import CreateCapabilitiesReactiveHarness from "./create-capabilities-reactive-harness.svelte";

describe("createCapabilities reactive agentId", () => {
  it("reactively switches agent when getter-backed agentId changes", async () => {
    const capsA = { identity: { name: "agent-a-bot" } };
    const capsB = { identity: { name: "agent-b-bot" } };

    const agentA = {
      agentId: "agent-a",
      capabilities: capsA,
      state: {},
      messages: [],
      isRunning: false,
    } as unknown as AbstractAgent;

    const agentB = {
      agentId: "agent-b",
      capabilities: capsB,
      state: {},
      messages: [],
      isRunning: false,
    } as unknown as AbstractAgent;

    let handlers: SubscribeToAgentSubscriber | undefined;
    const unsubscribe = vi.fn();

    const core = {
      agents: { "agent-a": agentA, "agent-b": agentB },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: undefined,
      runtimeTransport: "auto" as const,
      headers: {},
      getAgent: vi.fn((id: string) => (id === "agent-a" ? agentA : agentB)),
      subscribeToAgentWithOptions: vi.fn(
        (_a: AbstractAgent, nextHandlers: SubscribeToAgentSubscriber) => {
          handlers = nextHandlers;
          return { unsubscribe };
        },
      ),
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

    const view = render(CreateCapabilitiesReactiveHarness, {
      props: { context },
    });

    await waitFor(() => {
      expect(view.getByTestId("capabilities").textContent).toBe(
        JSON.stringify(capsA),
      );
    });

    expect(core.getAgent).toHaveBeenCalledWith("agent-a");

    await fireEvent.click(view.getByTestId("switch"));

    await waitFor(() => {
      expect(view.getByTestId("capabilities").textContent).toBe(
        JSON.stringify(capsB),
      );
    });

    expect(core.getAgent).toHaveBeenCalledWith("agent-b");

    view.unmount();
  });
});
