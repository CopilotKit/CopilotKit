import { defineComponent } from "vue";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import { getAssistantTurn } from "../assistant-turn";

const mockWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

beforeEach(() => mockWriteText.mockClear());

// One user message answered by three assistant messages (text, a tool call,
// then more text), followed by a second, single-message turn.
const messages: Message[] = [
  { id: "u1", role: "user", content: "Plan the launch" },
  { id: "a1", role: "assistant", content: "Let me look that up." },
  {
    id: "a2",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tc1",
        type: "function",
        function: { name: "search", arguments: "{}" },
      },
    ],
  },
  { id: "t1", role: "tool", toolCallId: "tc1", content: "3 results" },
  { id: "a3", role: "assistant", content: "Here is the plan." },
  { id: "u2", role: "user", content: "Thanks" },
  { id: "a4", role: "assistant", content: "Anytime." },
];

const renderView = (
  props: { isRunning?: boolean } = {},
  toolbarScope?: "turn" | "message",
) =>
  render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        CopilotChatMessageView,
        CopilotChatAssistantMessage,
      },
      setup() {
        return { messages, props, toolbarScope };
      },
      // The Vue equivalent of React's `assistantMessage={{ toolbarScope }}`
      // is the `#assistant-message` slot.
      template: `
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <CopilotChatConfigurationProvider thread-id="turn-toolbar">
            <CopilotChatMessageView :messages="messages" v-bind="props">
              <template
                v-if="toolbarScope"
                #assistant-message="{ message, messages: allMessages, isRunning }"
              >
                <CopilotChatAssistantMessage
                  :message="message"
                  :messages="allMessages"
                  :is-running="isRunning"
                  :toolbar-scope="toolbarScope"
                />
              </template>
            </CopilotChatMessageView>
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      `,
    }),
  );

describe("getAssistantTurn", () => {
  it("groups the assistant messages between two user messages", () => {
    expect(getAssistantTurn(messages, "a2")).toEqual({
      lastMessageId: "a3",
      content: "Let me look that up.\n\nHere is the plan.",
      isLatest: false,
    });
    expect(getAssistantTurn(messages, "a4")).toEqual({
      lastMessageId: "a4",
      content: "Anytime.",
      isLatest: true,
    });
  });

  it("returns undefined for non-assistant or unknown messages", () => {
    expect(getAssistantTurn(messages, "u1")).toBeUndefined();
    expect(getAssistantTurn(messages, "missing")).toBeUndefined();
  });
});

describe("assistant toolbar scope", () => {
  it("shows one toolbar per reply by default, copying the whole reply", async () => {
    renderView();

    const toolbars = screen.getAllByTestId("copilot-assistant-toolbar");
    expect(toolbars).toHaveLength(2);

    await fireEvent.click(
      within(toolbars[0]!).getByRole("button", { name: /copy/i }),
    );
    await waitFor(() =>
      expect(mockWriteText).toHaveBeenCalledWith(
        "Let me look that up.\n\nHere is the plan.",
      ),
    );
  });

  it("hides the latest reply's toolbar while it is still running", () => {
    renderView({ isRunning: true });
    expect(screen.getAllByTestId("copilot-assistant-toolbar")).toHaveLength(1);
  });

  it('gives every assistant message a toolbar with toolbarScope="message"', () => {
    renderView({}, "message");
    // a2 has no text, so it has no toolbar in either scope.
    expect(screen.getAllByTestId("copilot-assistant-toolbar")).toHaveLength(3);
  });
});

describe("assistant toolbar scope (Vue-specific semantics)", () => {
  it("emits read-aloud with the whole reply's text but keeps the last message's id", async () => {
    const onReadAloud = vi.fn();
    render(
      defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { messages, message: messages[4], onReadAloud };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider thread-id="turn-toolbar">
              <CopilotChatAssistantMessage
                :message="message"
                :messages="messages"
                @read-aloud="onReadAloud"
              />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      }),
    );

    await fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));
    expect(onReadAloud).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "a3",
        content: "Let me look that up.\n\nHere is the plan.",
      }),
    );
  });
});
