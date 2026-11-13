import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { Suggestion } from "@copilotkit/core";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import Harness from "./create-suggestions-reactive-harness.svelte";

function mockCore(overrides?: Partial<CopilotKitCoreSvelte>) {
  const core = {
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
  return core;
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

describe("createSuggestions", () => {
  it("calls getSuggestions and subscribe on mount", async () => {
    const core = mockCore({
      getSuggestions: vi.fn(() => ({
        suggestions: [{ title: "s1", message: "p1", isLoading: false }],
        isLoading: false,
      })),
    });
    const context = mockContext(core);
    render(Harness, { props: { context } });

    await waitFor(() => {
      expect(core.getSuggestions).toHaveBeenCalledWith("agent-a");
    });
    expect(core.subscribe).toHaveBeenCalledOnce();
  });

  it("unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    const core = mockCore({
      subscribe: vi.fn(() => ({ unsubscribe })),
    });
    const context = mockContext(core);
    const view = render(Harness, { props: { context } });

    await waitFor(() => {
      expect(core.subscribe).toHaveBeenCalled();
    });

    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("reactively switches agentId via getter", async () => {
    const getSuggestions = vi.fn((id: string) => ({
      suggestions: [
        { title: id, message: id, isLoading: false } satisfies Suggestion,
      ],
      isLoading: false,
    }));
    const core = mockCore({
      agents: { "agent-a": {} as any, "agent-b": {} as any },
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      getSuggestions,
      subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    });

    const context = mockContext(core);
    const view = render(Harness, { props: { context } });

    await waitFor(() => {
      expect(core.getSuggestions).toHaveBeenCalledWith("agent-a");
    });

    await fireEvent.click(view.getByTestId("switch"));

    await waitFor(() => {
      expect(core.getSuggestions).toHaveBeenCalledWith("agent-b");
    });
  });

  it("throws if used outside CopilotKitProvider", () => {
    expect(() => {
      render(Harness, {
        props: { context: null as unknown as CopilotKitContextValue },
      });
    }).toThrow("createSuggestions must be used within CopilotKitProvider");
  });
});
