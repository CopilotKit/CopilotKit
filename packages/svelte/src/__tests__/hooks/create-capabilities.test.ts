import type { AbstractAgent } from "@ag-ui/client";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import CreateCapabilitiesHarness from "./create-capabilities-harness.svelte";

describe("createCapabilities", () => {
  it("returns capabilities from the resolved agent via reactive binding", async () => {
    const capabilities = { identity: { name: "test-bot" } };
    const agent = {
      agentId: "test-agent",
      capabilities,
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

    const view = render(CreateCapabilitiesHarness, { props: { context } });

    await waitFor(() => {
      expect(view.getByTestId("capabilities").textContent).toBe(
        JSON.stringify(capabilities),
      );
    });

    view.unmount();
  });
});
