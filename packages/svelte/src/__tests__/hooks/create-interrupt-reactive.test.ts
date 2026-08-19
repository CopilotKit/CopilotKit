import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import Harness from "./create-interrupt-reactive-harness.svelte";

describe("createInterrupt reactive agentId", () => {
  it("unsubscribes from the old agent and subscribes to the new agent", async () => {
    const unsubscribeA = vi.fn();
    const unsubscribeB = vi.fn();
    const agentA = {
      agentId: "agent-a",
      state: {},
      messages: [],
      isRunning: false,
      subscribe: vi.fn(() => ({ unsubscribe: unsubscribeA })),
    } as unknown as AbstractAgent;
    const agentB = {
      agentId: "agent-b",
      state: {},
      messages: [],
      isRunning: false,
      subscribe: vi.fn(() => ({ unsubscribe: unsubscribeB })),
    } as unknown as AbstractAgent;

    const core = {
      agents: { "agent-a": agentA, "agent-b": agentB },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: undefined,
      runtimeTransport: "auto" as const,
      headers: {},
      getAgent: vi.fn((id: string) => (id === "agent-a" ? agentA : agentB)),
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

    const view = render(Harness, { props: { context } });
    await waitFor(() => expect(agentA.subscribe).toHaveBeenCalledOnce());

    await fireEvent.click(view.getByTestId("switch"));
    await waitFor(() => expect(agentB.subscribe).toHaveBeenCalledOnce());
    expect(unsubscribeA).toHaveBeenCalledOnce();

    view.unmount();
    expect(unsubscribeB).toHaveBeenCalledOnce();
  });
});
