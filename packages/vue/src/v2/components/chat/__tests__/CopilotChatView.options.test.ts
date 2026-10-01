/**
 * Message and input options set on the chat (instead of through slots):
 * `inlineCursor`, `assistantMessageToolbarScope`, `userMessageMarkdown`,
 * `inputLayout` and `inputHighlightMarkdown`.
 */
import { defineComponent } from "vue";
import type { Component } from "vue";
import { render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotChat from "../CopilotChat.vue";
import CopilotChatView from "../CopilotChatView.vue";
import CopilotPopup from "../CopilotPopup.vue";
import CopilotPopupView from "../CopilotPopupView.vue";
import CopilotSidebar from "../CopilotSidebar.vue";
import CopilotSidebarView from "../CopilotSidebarView.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";

const conversation: Message[] = [
  { id: "u1", role: "user", content: "Make it **bold**" },
  { id: "a1", role: "assistant", content: "Looking into it." },
  { id: "a2", role: "assistant", content: "Done." },
];

function renderView(
  view: Component,
  props: Record<string, unknown>,
  messages: Message[] = conversation,
) {
  return render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        ChatView: view,
      },
      setup() {
        return { props, messages };
      },
      template: `
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <CopilotChatConfigurationProvider thread-id="options">
            <ChatView :messages="messages" v-bind="props" />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      `,
    }),
  );
}

const toolbars = () => screen.queryAllByTestId("copilot-assistant-toolbar");
const inputLayout = () =>
  screen
    .getAllByTestId("copilot-chat-input-shell")[0]!
    .getAttribute("data-layout");
const previews = () =>
  screen.queryAllByTestId("copilot-chat-input-textarea-preview");

describe("CopilotChatView options", () => {
  it("keeps the inline cursor on by default", async () => {
    renderView(CopilotChatView, { isRunning: true }, [
      conversation[0]!,
      conversation[1]!,
    ]);
    await waitFor(() =>
      expect(document.querySelector("[data-streaming-cursor]")).not.toBeNull(),
    );
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("uses the redesign's defaults", async () => {
    renderView(CopilotChatView, {});
    await waitFor(() =>
      expect(document.querySelector("[data-streamdown='strong']")).not.toBe(
        null,
      ),
    );
    expect(toolbars()).toHaveLength(1);
    expect(inputLayout()).toBe("compact");
    expect(previews()).toHaveLength(1);
  });

  it("forwards the message options", () => {
    renderView(CopilotChatView, {
      userMessageMarkdown: false,
      assistantMessageToolbarScope: "message",
    });
    expect(screen.getByText("Make it **bold**")).toBeDefined();
    expect(toolbars()).toHaveLength(2);
  });

  it("forwards inlineCursor", () => {
    renderView(CopilotChatView, { isRunning: true, inlineCursor: false }, [
      conversation[0]!,
      conversation[1]!,
    ]);
    expect(document.querySelector("[data-streaming-cursor]")).toBeNull();
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it.each([
    { screen: "the conversation", messages: conversation },
    { screen: "the welcome screen", messages: [] },
  ])("forwards the input options on $screen", async ({ messages }) => {
    renderView(
      CopilotChatView,
      { inputLayout: "stacked", inputHighlightMarkdown: false },
      messages,
    );
    await waitFor(() => expect(inputLayout()).toBe("expanded"));
    expect(previews()).toHaveLength(0);
  });
});

describe.each([
  { name: "CopilotPopupView", view: CopilotPopupView },
  { name: "CopilotSidebarView", view: CopilotSidebarView },
])("$name options", ({ view }) => {
  it("keeps the inline cursor on by default", async () => {
    renderView(view, { isRunning: true }, [conversation[0]!, conversation[1]!]);
    await waitFor(() =>
      expect(document.querySelector("[data-streaming-cursor]")).not.toBeNull(),
    );
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("forwards the message and input options", async () => {
    renderView(view, {
      userMessageMarkdown: false,
      assistantMessageToolbarScope: "message",
      inputLayout: "stacked",
      inputHighlightMarkdown: false,
    });
    expect(screen.getByText("Make it **bold**")).toBeDefined();
    expect(toolbars()).toHaveLength(2);
    await waitFor(() => expect(inputLayout()).toBe("expanded"));
    expect(previews()).toHaveLength(0);
  });
});

describe.each([
  { name: "CopilotChat", chat: CopilotChat },
  { name: "CopilotPopup", chat: CopilotPopup },
  { name: "CopilotSidebar", chat: CopilotSidebar },
])("$name options", ({ chat }) => {
  function renderChat(props: Record<string, unknown>, messages: Message[]) {
    const agent = new MockStepwiseAgent();
    agent.setMessages(messages);
    return render(
      defineComponent({
        components: { CopilotKitProvider, Chat: chat },
        setup() {
          return { agents: { default: agent }, props };
        },
        template: `
          <CopilotKitProvider :agents__unsafe_dev_only="agents">
            <Chat v-bind="props" />
          </CopilotKitProvider>
        `,
      }),
    );
  }

  it("forwards the message options", async () => {
    renderChat(
      { userMessageMarkdown: false, assistantMessageToolbarScope: "message" },
      conversation,
    );
    await waitFor(() => expect(toolbars()).toHaveLength(2));
    expect(screen.getByText("Make it **bold**")).toBeDefined();
  });

  it("forwards the input options to the welcome screen", async () => {
    renderChat({ inputLayout: "stacked", inputHighlightMarkdown: false }, []);
    await waitFor(() => expect(inputLayout()).toBe("expanded"));
    expect(previews()).toHaveLength(0);
  });
});

describe("CopilotChatView suggestions in a conversation", () => {
  const suggestions = [{ title: "Next step", message: "What's next?" }];

  it("docks them above the input", () => {
    renderView(CopilotChatView, { suggestions });
    const overlay = screen.getByTestId("copilot-input-overlay");
    expect(
      overlay.querySelector("[data-testid='copilot-chat-suggestion-view']"),
    ).not.toBeNull();
  });

  it("leaves them to a custom scroll-view slot", () => {
    render(
      defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatView,
        },
        setup() {
          return { messages: conversation, suggestions };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider thread-id="options">
              <CopilotChatView :messages="messages" :suggestions="suggestions">
                <template #scroll-view="{ suggestions: slotSuggestions }">
                  <ul data-testid="custom-scroll-view">
                    <li v-for="s in slotSuggestions" :key="s.title">{{ s.title }}</li>
                  </ul>
                </template>
              </CopilotChatView>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      }),
    );
    expect(screen.getByTestId("custom-scroll-view").textContent).toBe(
      "Next step",
    );
    expect(screen.queryByTestId("copilot-chat-suggestion-view")).toBeNull();
  });
});
