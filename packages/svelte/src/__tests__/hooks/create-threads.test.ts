import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import Harness from "./create-threads-harness.svelte";

function mockCore(overrides?: Partial<CopilotKitCoreSvelte>) {
  return {
    agents: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    runtimeUrl: undefined,
    runtimeTransport: "auto" as const,
    headers: {},
    getAgent: vi.fn(),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getTool: vi.fn(),
    addTool: vi.fn(),
    removeTool: vi.fn(),
    getSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    reloadSuggestions: vi.fn(),
    clearSuggestions: vi.fn(),
    addSuggestionsConfig: vi.fn(),
    removeSuggestionsConfig: vi.fn(),
    addHookRenderToolCall: vi.fn(),
    removeHookRenderToolCall: vi.fn(),
    removeHookRenderToolCallByName: vi.fn(),
    addPropRenderToolCall: vi.fn(),
    removePropRenderToolCall: vi.fn(),
    setInterruptState: vi.fn(),
    registerThreadStore: vi.fn(),
    unregisterThreadStore: vi.fn(),
    addContext: vi.fn(),
    removeContext: vi.fn(),
    ...overrides,
  } as unknown as CopilotKitCoreSvelte;
}

function mockContext(core: CopilotKitCoreSvelte): CopilotKitContextValue {
  return {
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
}

describe("createThreads", () => {
  it("shows error when runtime is not configured", async () => {
    const core = mockCore();
    const context = mockContext(core);
    const view = render(Harness, { props: { context, agentId: "test-agent" } });

    await waitFor(() => {
      const parsed = JSON.parse(view.getByTestId("threads").textContent!);
      expect(parsed.isLoading).toBe(false);
      expect(parsed.error).toBe("Runtime URL is not configured");
    });
  });

  it("returns empty threads when runtime is connected", async () => {
    const core = mockCore({
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      runtimeUrl: "http://localhost:4000",
      threadEndpoints: {
        list: true,
        mutations: true,
        inspect: true,
        realtimeMetadata: true,
      },
      registerThreadStore: vi.fn(),
      unregisterThreadStore: vi.fn(),
    });
    const context = mockContext(core);
    const view = render(Harness, { props: { context, agentId: "test-agent" } });

    await waitFor(() => {
      expect(core.registerThreadStore).toHaveBeenCalledWith(
        "test-agent",
        expect.anything(),
      );
    });

    view.unmount();
    expect(core.unregisterThreadStore).toHaveBeenCalledWith("test-agent");
  });

  it("throws if used outside CopilotKitProvider", () => {
    expect(() => {
      render(Harness, {
        props: {
          context: null as unknown as CopilotKitContextValue,
          agentId: "test",
        },
      });
    }).toThrow("createThreads must be used within CopilotKitProvider");
  });
});
