import type { AbstractAgent } from "@ag-ui/client";
import type { Message } from "@ag-ui/core";
import type { SubscribeToAgentSubscriber } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { CopilotKitCoreSvelte } from "../../lib/svelte-core";
import PopupHarness from "./popup-persistence-harness.svelte";
import SidebarHarness from "./sidebar-persistence-harness.svelte";

class TestAgent {
  agentId = "default";
  messages: Message[] = [];
  state: Record<string, unknown> = {};
  isRunning = false;
  threadId?: string;

  clone() {
    return new TestAgent();
  }

  setMessages(messages: Message[]) {
    this.messages = messages;
  }

  setState(state: Record<string, unknown>) {
    this.state = state;
  }

  addMessage(message: Message) {
    this.messages = [...this.messages, message];
  }

  subscribe() {
    return { unsubscribe() {} };
  }
}

type MockCore = CopilotKitCoreSvelte & {
  subscribeToAgentWithOptions: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  runAgent: ReturnType<typeof vi.fn>;
};

function createCore(): MockCore {
  const agents = { default: new TestAgent() as unknown as AbstractAgent };
  return {
    agents,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: undefined,
    runtimeTransport: "auto",
    headers: {},
    getAgent: vi.fn((id: string) => agents[id as keyof typeof agents]),
    subscribeToAgentWithOptions: vi.fn(() => ({ unsubscribe: vi.fn() })),
    getSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    runAgent: vi.fn(async () => {}),
    stopAgent: vi.fn(),
  } as unknown as MockCore;
}

function subscriptionCounts(core: MockCore) {
  return {
    agentSubscriptions: core.subscribeToAgentWithOptions.mock.calls.length,
    coreSubscriptions: core.subscribe.mock.calls.length,
  };
}

function lastAgentHandlers(core: MockCore): SubscribeToAgentSubscriber {
  const calls = core.subscribeToAgentWithOptions.mock.calls as Array<
    [AbstractAgent, SubscribeToAgentSubscriber]
  >;
  return calls.at(-1)?.[1] ?? {};
}

describe.each([
  {
    name: "CopilotPopup",
    harness: PopupHarness,
    overlay: ".copilotkit-popup-overlay",
  },
  {
    name: "CopilotSidebar",
    harness: SidebarHarness,
    overlay: ".copilotkit-sidebar-overlay",
  },
])("$name visibility", ({ harness, overlay }) => {
  it("preserves the mounted chat instance, state, and subscriptions across close/reopen", async () => {
    const core = createCore();
    const view = render(harness, { props: { core } });

    const textarea = (await waitFor(() => {
      const field = view.getByPlaceholderText("Type a message...");
      expect(field).toBeTruthy();
      return field;
    })) as HTMLTextAreaElement;

    // Establish stable chat state: typed (controlled) input.
    await fireEvent.input(textarea, { target: { value: "draft in progress" } });
    await waitFor(() => expect(textarea.value).toBe("draft in progress"));

    const chatNode = view.container.querySelector(".copilotkit-chat");
    expect(chatNode).toBeTruthy();
    const before = subscriptionCounts(core);
    expect(before.agentSubscriptions).toBeGreaterThan(0);

    const toggle = view.container.querySelector(
      ".copilotkit-toggle-btn",
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    // Close: the chat subtree stays mounted but is hidden and non-interactive.
    await fireEvent.click(toggle);
    await waitFor(() => {
      const overlayNode = view.container.querySelector(overlay);
      expect(overlayNode?.hasAttribute("hidden")).toBe(true);
    });
    expect(view.container.querySelector(".copilotkit-chat")).toBe(chatNode);
    // The toggle remains available while closed.
    expect(view.container.querySelector(".copilotkit-toggle-btn")).toBeTruthy();

    // Reopen: same DOM identity, same input state, no new subscriptions.
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        view.container.querySelector(overlay)?.hasAttribute("hidden"),
      ).toBe(false);
    });
    const reopenedTextarea = view.getByPlaceholderText(
      "Type a message...",
    ) as HTMLTextAreaElement;
    expect(reopenedTextarea).toBe(textarea);
    expect(reopenedTextarea.value).toBe("draft in progress");
    expect(view.container.querySelector(".copilotkit-chat")).toBe(chatNode);
    expect(subscriptionCounts(core)).toEqual(before);

    // Submitted messages live on the mounted agent: they survive a close/reopen.
    await fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(core.runAgent).toHaveBeenCalled();
    // The mocked core never emits agent events itself; deliver the
    // messages-changed notification the subscription would produce.
    lastAgentHandlers(core).onMessagesChanged?.({ agent: undefined } as never);
    await waitFor(() => {
      expect(view.getByText("draft in progress")).toBeTruthy();
    });

    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        view.container.querySelector(overlay)?.hasAttribute("hidden"),
      ).toBe(true);
    });
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(view.getByText("draft in progress")).toBeTruthy();
    });
    expect(view.container.querySelector(".copilotkit-chat")).toBe(chatNode);
    expect(subscriptionCounts(core)).toEqual(before);

    view.unmount();
  });

  it("still closes via overlay click and Escape", async () => {
    const core = createCore();
    const view = render(harness, { props: { core } });

    await waitFor(() => {
      expect(view.getByPlaceholderText("Type a message...")).toBeTruthy();
    });
    const toggle = view.container.querySelector(
      ".copilotkit-toggle-btn",
    ) as HTMLButtonElement;

    // Overlay close.
    await fireEvent.click(view.container.querySelector(overlay) as HTMLElement);
    await waitFor(() => {
      expect(
        view.container.querySelector(overlay)?.hasAttribute("hidden"),
      ).toBe(true);
    });

    // Reopen, then Escape close.
    await fireEvent.click(toggle);
    await waitFor(() => {
      expect(
        view.container.querySelector(overlay)?.hasAttribute("hidden"),
      ).toBe(false);
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await waitFor(() => {
      expect(
        view.container.querySelector(overlay)?.hasAttribute("hidden"),
      ).toBe(true);
    });

    view.unmount();
  });
});
