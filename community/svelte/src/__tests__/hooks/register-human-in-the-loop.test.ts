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
    const firstPending = registeredTool.handler(
      { action: "delete" },
      { toolCall: { id: "call-1" } },
    );
    const secondPending = registeredTool.handler(
      { action: "archive" },
      { toolCall: { id: "call-2" } },
    );
    renderer!.render({
      toolCallId: "call-1",
      status: "executing",
      args: { action: "delete" },
    });
    renderer!.render({
      toolCallId: "call-2",
      status: "executing",
      args: { action: "archive" },
    });
    const firstRenderProps = onRender.mock.calls.at(0)![0];
    const secondRenderProps = onRender.mock.calls.at(1)![0];
    expect(firstRenderProps).toEqual(
      expect.objectContaining({
        name: "approve-action",
        description: "Approve the action",
        respond: expect.any(Function),
      }),
    );
    expect(secondRenderProps).toEqual(
      expect.objectContaining({
        name: "approve-action",
        description: "Approve the action",
        respond: expect.any(Function),
      }),
    );

    let firstResult: unknown;
    let secondResult: unknown;
    void firstPending.then((result: unknown) => {
      firstResult = result;
    });
    void secondPending.then((result: unknown) => {
      secondResult = result;
    });

    await firstRenderProps.respond("first-approved");
    await waitFor(() => expect(firstResult).toBe("first-approved"));
    expect(secondResult).toBeUndefined();

    await secondRenderProps.respond("second-approved");
    await waitFor(() => expect(secondResult).toBe("second-approved"));

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
