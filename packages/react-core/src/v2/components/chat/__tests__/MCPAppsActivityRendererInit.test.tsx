/**
 * Adapter-level tests for the widget start-up states.
 *
 * A widget can load its HTML yet never initialize (e.g. a CDN dependency it
 * imports returns HTTP 500). The session reports that as a fatal `onError`
 * after `widgetInitializationTimeoutMs`; the adapter must turn it into a
 * visible message with a Retry action instead of leaving a blank iframe.
 *
 * Like the Seed test, this mocks the bridge package so the hooks can be driven
 * directly.
 */
import {
  act,
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
  onInitialized?: () => void;
  onError?: (err: Error) => void;
};

const { bindMcpAppSpy } = vi.hoisted(() => {
  const bind = vi.fn((_opts: { hooks?: Hooks }) => ({
    sendToolInput: vi.fn(),
    sendToolResult: vi.fn(),
    syncContent: vi.fn(),
    teardown: vi.fn(),
  }));
  return { bindMcpAppSpy: bind };
});

vi.mock("@copilotkit/mcp-apps-renderer", () => ({
  bindMcpApp: bindMcpAppSpy,
}));

const content = {
  resourceUri: "ui://test/app",
  serverHash: "hash",
} as MCPAppsActivityContent;

function renderAdapter() {
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
  return {
    ...view,
    changeContent: (next: MCPAppsActivityContent) =>
      view.rerender(adapter(next)),
  };
}

const hooksOfBind = (call: number) =>
  bindMcpAppSpy.mock.calls[call][0].hooks as Hooks;

describe("MCPAppsActivityRenderer widget start-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a starting state until the widget initializes", async () => {
    renderAdapter();
    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));

    act(() => hooksOfBind(0).onResource?.({ uri: "ui://test/app" }));
    expect(await screen.findByText("Starting app...")).toBeDefined();

    act(() => hooksOfBind(0).onInitialized?.());
    await waitFor(() =>
      expect(screen.queryByText("Starting app...")).toBeNull(),
    );
  });

  it("shows the error, hides the blank iframe, and re-binds on Retry", async () => {
    const { container } = renderAdapter();
    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));
    act(() => hooksOfBind(0).onResource?.({ uri: "ui://test/app" }));
    act(() => hooksOfBind(0).onSizeChanged?.({ height: 40 }));
    const frame = container.querySelector("iframe")!;
    const wrapper = frame.parentElement!;
    expect(wrapper.style.height).toBe("40px");

    act(() =>
      hooksOfBind(0).onError?.(
        new Error("The MCP App loaded but did not initialize within 20000ms."),
      ),
    );

    expect(
      await screen.findByText(/did not initialize within 20000ms/),
    ).toBeDefined();
    expect(screen.queryByText("Starting app...")).toBeNull();
    expect(container.querySelector("iframe")?.style.display).toBe("none");
    // The error and Retry must grow with their content, even if the dead widget
    // reported a tiny height before it failed to initialize.
    expect(wrapper.style.height).toBe("auto");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(2));
    // A fresh, visible iframe and a cleared error.
    expect(screen.queryByText(/did not initialize/)).toBeNull();
    const iframes = container.querySelectorAll("iframe");
    expect(iframes).toHaveLength(1);
    expect(iframes[0].style.display).toBe("block");
    expect(bindMcpAppSpy.mock.results[0].value.teardown).toHaveBeenCalledOnce();
    expect(
      bindMcpAppSpy.mock.results[1].value.syncContent,
    ).toHaveBeenCalledWith(content);
    act(() => hooksOfBind(1).onResource?.({ uri: "ui://test/app" }));
    expect(screen.getByText("Starting app...")).toBeDefined();
    act(() => hooksOfBind(1).onInitialized?.());
    expect(screen.queryByText("Starting app...")).toBeNull();
  });

  it("clears the previous widget's size and resource metadata on a new binding", async () => {
    const { container, changeContent } = renderAdapter();
    await waitFor(() => expect(bindMcpAppSpy).toHaveBeenCalledTimes(1));
    act(() => {
      hooksOfBind(0).onResource?.({
        uri: "ui://test/app",
        _meta: { ui: { prefersBorder: true } },
      });
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
  });
});
