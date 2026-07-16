import { render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import RegisterRenderToolCallHarness from "./register-render-tool-call-harness.svelte";
import RegisterFrontendToolHarness from "./register-frontend-tool-harness.svelte";

function createMockContext() {
  const core = {
    agents: {},
    runtimeConnectionStatus: "disconnected",
    runtimeUrl: undefined,
    runtimeTransport: "auto" as const,
    headers: {},
    getAgent: vi.fn(),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getTool: vi.fn(),
    addTool: vi.fn(),
    removeTool: vi.fn(),
    addHookFrontendTool: vi.fn(),
    removeHookFrontendTool: vi.fn(),
    getSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    addContext: vi.fn(),
    removeContext: vi.fn(),
    reloadSuggestions: vi.fn(),
    clearSuggestions: vi.fn(),
    addSuggestionsConfig: vi.fn(),
    removeSuggestionsConfig: vi.fn(),
    addHookRenderToolCall: vi.fn(),
    removeHookRenderToolCall: vi.fn(),
    removeHookRenderToolCallByName: vi.fn(),
    setInterruptState: vi.fn(),
    waitForPendingFrameworkUpdates: vi.fn(),
  } as unknown as CopilotKitCoreSvelte;

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

describe("registerRenderToolCall cleanup", () => {
  it("registers the renderer on mount and removes it on unmount", () => {
    const context = createMockContext();
    const addHookRenderToolCall = context.copilotkit
      .addHookRenderToolCall as ReturnType<typeof vi.fn>;
    const removeHookRenderToolCall = context.copilotkit
      .removeHookRenderToolCall as ReturnType<typeof vi.fn>;

    const view = render(RegisterRenderToolCallHarness, { props: { context } });

    expect(addHookRenderToolCall).toHaveBeenCalledTimes(1);
    expect(addHookRenderToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: "test-renderer" }),
    );

    view.unmount();

    expect(removeHookRenderToolCall).toHaveBeenCalledTimes(1);
    expect(removeHookRenderToolCall).toHaveBeenCalledWith(
      "test-renderer",
      undefined,
    );
  });
});

describe("registerFrontendTool cleanup", () => {
  it("removes both tool and renderer on unmount when render is provided", () => {
    const context = createMockContext();
    const addTool = context.copilotkit.addHookFrontendTool as ReturnType<
      typeof vi.fn
    >;
    const removeTool = context.copilotkit.removeHookFrontendTool as ReturnType<
      typeof vi.fn
    >;
    const addHookRenderToolCall = context.copilotkit
      .addHookRenderToolCall as ReturnType<typeof vi.fn>;
    const removeHookRenderToolCall = context.copilotkit
      .removeHookRenderToolCall as ReturnType<typeof vi.fn>;

    const view = render(RegisterFrontendToolHarness, { props: { context } });

    expect(addTool).toHaveBeenCalledTimes(1);
    expect(addHookRenderToolCall).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(removeTool).toHaveBeenCalledTimes(1);
    expect(removeTool).toHaveBeenCalledWith("test-tool", undefined);
    expect(removeHookRenderToolCall).toHaveBeenCalledTimes(1);
    expect(removeHookRenderToolCall).toHaveBeenCalledWith(
      "test-tool",
      undefined,
    );
  });
});
