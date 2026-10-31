/** React startup watchdog and recovery, driven through the session's hooks. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { vi } from "vitest";
import React from "react";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import {
  MCPAppsActivityRenderer,
  MCPAppsActivityType,
} from "../../../components/MCPAppsActivityRenderer";
import type { MCPAppsActivityContent } from "../../../components/MCPAppsActivityRenderer";

type Hooks = {
  onResource?: (resource: {
    uri: string;
    _meta?: { ui?: { prefersBorder?: boolean } };
  }) => void;
  onSizeChanged?: (size: { width?: number; height?: number }) => void;
  onSandboxReady?: () => void;
  onInitialized?: () => void;
  onError?: (err: Error) => void;
};
const { bindMcpAppSpy } = vi.hoisted(() => ({
  bindMcpAppSpy: vi.fn((_opts: { hooks?: Hooks }) => ({
    syncContent: vi.fn(),
    teardown: vi.fn(),
  })),
}));
vi.mock("@copilotkit/mcp-apps-renderer", () => ({ bindMcpApp: bindMcpAppSpy }));
const content = {
  resourceUri: "ui://test/app",
  serverHash: "hash",
} as MCPAppsActivityContent;
const startupError = "The app could not start. Please try again.";

async function renderAdapter() {
  const agent = new MockStepwiseAgent();
  agent.agentId = "init-agent";
  const adapter = (activityContent: MCPAppsActivityContent) => (
    <CopilotKitProvider agents__unsafe_dev_only={{ "init-agent": agent }}>
      <CopilotChatConfigurationProvider agentId="init-agent" threadId="t1">
        <MCPAppsActivityRenderer
          activityType={MCPAppsActivityType}
          content={activityContent}
          message={{ id: "activity-1" }}
          agent={agent}
        />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  );
  const view = render(adapter(content));
  await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));
  return {
    ...view,
    changeContent: (next: MCPAppsActivityContent) =>
      view.rerender(adapter(next)),
  };
}
const hooksOfBind = (call: number) => bindMcpAppSpy.mock.calls[call][0].hooks!;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const deliverResource = (call = 0) =>
  act(() => {
    hooksOfBind(call).onResource?.({ uri: "ui://test/app" });
    hooksOfBind(call).onSandboxReady?.();
  });
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MCPAppsActivityRenderer startup", () => {
  it("starts the deadline after sandbox delivery and cancels it on initialization", async () => {
    await renderAdapter();
    vi.useFakeTimers();
    act(() => hooksOfBind(0).onResource?.({ uri: "ui://test/app" }));
    expect(screen.getByText("Starting app...")).toBeDefined();
    await advance(20_000);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    act(() => hooksOfBind(0).onSandboxReady?.());
    await advance(19_999);
    act(() => hooksOfBind(0).onInitialized?.());
    expect(screen.queryByText("Starting app...")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await advance(20_000);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("replaces a stalled app with an unclipped error and retries a fresh session", async () => {
    const { container } = await renderAdapter();
    vi.useFakeTimers();
    deliverResource();
    act(() => hooksOfBind(0).onSizeChanged?.({ height: 40 }));
    const oldFrame = container.querySelector("iframe")!;
    const wrapper = oldFrame.parentElement!;
    expect(wrapper.style.height).toBe("40px");
    await advance(19_999);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    await advance(1);
    expect(screen.getByText(`Error: ${startupError}`)).toBeDefined();
    expect(oldFrame.style.display).toBe("none");
    expect(wrapper.style.height).toBe("auto");
    expect(bindMcpAppSpy.mock.results[0].value.teardown).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(() => vi.dynamicImportSettled());
    expect(bindMcpAppSpy).toHaveBeenCalledTimes(2);
    expect(oldFrame.isConnected).toBe(false);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
    expect(container.querySelector("iframe")!.style.display).toBe("block");
    expect(
      bindMcpAppSpy.mock.results[1].value.syncContent,
    ).toHaveBeenCalledWith(content);
    deliverResource(1);
    expect(screen.getByText("Starting app...")).toBeDefined();
    act(() => hooksOfBind(1).onInitialized?.());
    await advance(20_000);
    expect(screen.queryByText("Starting app...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("clears the startup timer on a session error", async () => {
    await renderAdapter();
    vi.useFakeTimers();
    deliverResource();
    act(() => hooksOfBind(0).onError?.(new Error("Resource unavailable")));
    expect(vi.getTimerCount()).toBe(0);
    await advance(20_000);
    expect(screen.getByText("Error: Resource unavailable")).toBeDefined();
    expect(screen.queryByText(`Error: ${startupError}`)).toBeNull();
  });

  it("clears the timer and session on unmount", async () => {
    const { unmount } = await renderAdapter();
    vi.useFakeTimers();
    deliverResource();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(bindMcpAppSpy.mock.results[0].value.teardown).toHaveBeenCalledOnce();
    await advance(20_000);
  });

  it("clears the previous widget's size and metadata on a new binding", async () => {
    const { container, changeContent } = await renderAdapter();
    act(() => {
      hooksOfBind(0).onResource?.({
        uri: "ui://test/app",
        _meta: { ui: { prefersBorder: true } },
      });
      hooksOfBind(0).onInitialized?.();
      hooksOfBind(0).onSizeChanged?.({ height: 320 });
    });
    const wrapper = container.querySelector("iframe")!.parentElement!;
    expect(wrapper.style.height).toBe("320px");
    expect(wrapper.style.borderRadius).toBe("8px");
    changeContent({ ...content, resourceUri: "ui://test/other" });
    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(2));
    expect(wrapper.style.height).toBe("auto");
    expect(wrapper.style.borderRadius).toBe("");
    expect(container.querySelector("iframe")!.style.height).toBe("100px");
    act(() => hooksOfBind(1).onResource?.({ uri: "ui://test/other" }));
    expect(screen.getByText("Starting app...")).toBeDefined();
  });
});
