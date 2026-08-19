import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import type { CopilotKitContextValue } from "../../providers/context";
import Harness from "./register-human-in-the-loop-harness.svelte";

describe("registerHumanInTheLoop", () => {
  it("registers a tool/renderer, resolves the handler, and cleans up", async () => {
    const addHookFrontendTool = vi.fn();
    const removeHookFrontendTool = vi.fn();
    const addHookRenderToolCall = vi.fn();
    const removeHookRenderToolCall = vi.fn();
    const core = {
      agents: {},
      runtimeConnectionStatus: "disconnected",
      runtimeUrl: undefined,
      runtimeTransport: "auto" as const,
      headers: {},
      addHookFrontendTool,
      removeHookFrontendTool,
      addHookRenderToolCall,
      removeHookRenderToolCall,
    } as unknown as CopilotKitCoreSvelte & {
      addHookFrontendTool: typeof addHookFrontendTool;
      removeHookFrontendTool: typeof removeHookFrontendTool;
      addHookRenderToolCall: typeof addHookRenderToolCall;
      removeHookRenderToolCall: typeof removeHookRenderToolCall;
    };
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
    const onRender = vi.fn();
    const view = render(Harness, { props: { context, onRender } });

    await waitFor(() => expect(addHookFrontendTool).toHaveBeenCalledOnce());
    const registeredTool = addHookFrontendTool.mock.calls[0]?.[0];
    const renderer = addHookRenderToolCall.mock.calls[0]?.[0];
    expect(registeredTool).toBeDefined();
    expect(renderer).toBeDefined();
    const pending = registeredTool.handler({ action: "delete" });
    renderer!.render({ status: "executing", args: { action: "delete" } });
    const renderProps = onRender.mock.calls.at(0)![0];
    expect(renderProps).toEqual(
      expect.objectContaining({
        name: "approve-action",
        description: "Approve the action",
        respond: expect.any(Function),
      }),
    );
    await renderProps.respond("approved");
    await expect(pending).resolves.toBe("approved");

    view.unmount();
    expect(removeHookFrontendTool).toHaveBeenCalledWith(
      "approve-action",
      undefined,
    );
    expect(removeHookRenderToolCall).toHaveBeenCalledWith(
      "approve-action",
      undefined,
    );
  });
});
