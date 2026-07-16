import type { AbstractAgent } from "@ag-ui/client";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../lib/svelte-core";
import type { CopilotKitContextValue } from "../providers/context";
import CreateAgentStateHarness from "./create-agent-state-harness.svelte";

class TestAgent {
  agentId = "test-agent";
  state: Record<string, unknown> = { status: "idle" };
  messages = [];
  isRunning = false;
}

describe("createAgent state updates", () => {
  it("invalidates consumers when the same agent instance changes state", async () => {
    const agent = new TestAgent() as unknown as AbstractAgent;
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
        (_agent: AbstractAgent, nextHandlers: SubscribeToAgentSubscriber) => {
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

    const view = render(CreateAgentStateHarness, { props: { context } });

    await waitFor(() => {
      expect(view.getByTestId("agent-state").textContent).toBe(
        '{"status":"idle"}',
      );
      expect(handlers?.onStateChanged).toBeTypeOf("function");
    });

    (agent as unknown as TestAgent).state = { status: "streaming" };
    handlers?.onStateChanged?.({ agent } as never);

    await waitFor(() => {
      expect(view.getByTestId("agent-state").textContent).toBe(
        '{"status":"streaming"}',
      );
    });

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
