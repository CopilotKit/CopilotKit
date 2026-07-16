import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import ConnectAgentContextHarness from "./connect-agent-context-harness.svelte";
import ConnectAgentContextPlainHarness from "./connect-agent-context-plain-harness.svelte";

function createMockCore() {
  let ctxCounter = 0;
  const addContext = vi.fn(() => `ctx-${++ctxCounter}`);
  return {
    addContext,
    removeContext: vi.fn(),
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
  } as unknown as CopilotKitCoreSvelte & { addContext: typeof addContext };
}

function createContext(core: CopilotKitCoreSvelte): CopilotKitContextValue {
  return {
    copilotkit: core,
    executingToolCallIds: new Set(),
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

describe("connectAgentContext", () => {
  it("calls addContext with plain values on mount, and never re-runs", async () => {
    const core = createMockCore();
    const context = createContext(core);
    const view = render(ConnectAgentContextPlainHarness, {
      props: { context },
    });

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledWith(
        expect.objectContaining({ value: "plain-value" }),
      );
    });

    expect(core.addContext).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("re-registers context when getter-backed $state changes", async () => {
    const core = createMockCore();
    const context = createContext(core);
    const view = render(ConnectAgentContextHarness, { props: { context } });

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledWith(
        expect.objectContaining({ value: "initial" }),
      );
    });

    expect(core.addContext).toHaveBeenCalledTimes(1);

    await fireEvent.click(view.getByTestId("update"));

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledWith(
        expect.objectContaining({ value: "updated" }),
      );
    });

    expect(core.addContext).toHaveBeenCalledTimes(2);

    view.unmount();
  });

  it("removes previous context entry on re-run", async () => {
    const core = createMockCore();
    const context = createContext(core);
    const view = render(ConnectAgentContextHarness, { props: { context } });

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledTimes(1);
    });

    const firstId = core.addContext.mock.results.at(0)!.value;
    await fireEvent.click(view.getByTestId("update"));

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledTimes(2);
    });

    expect(core.removeContext).toHaveBeenCalledWith(firstId);

    view.unmount();
  });

  it("cleans up context on unmount", async () => {
    const core = createMockCore();
    const context = createContext(core);
    const view = render(ConnectAgentContextHarness, { props: { context } });

    await waitFor(() => {
      expect(core.addContext).toHaveBeenCalledTimes(1);
    });

    const lastId = core.addContext.mock.results.at(0)!.value;
    view.unmount();

    expect(core.removeContext).toHaveBeenCalledWith(lastId);
  });

  it("throws if used outside CopilotKitProvider", () => {
    expect(() => {
      render(ConnectAgentContextPlainHarness, {
        props: { context: null as unknown as CopilotKitContextValue },
      });
    }).toThrow("connectAgentContext must be used within CopilotKitProvider");
  });
});
