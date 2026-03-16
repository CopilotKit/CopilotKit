import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import type { AssistantMessage, Message, UserMessage } from "@ag-ui/core";
import type { Suggestion } from "@copilotkitnext/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";
import CopilotChatView from "../CopilotChatView.vue";

const chatMessages: Message[] = [
  {
    id: "user-1",
    role: "user",
    content: "Hello",
    timestamp: new Date(),
  },
  {
    id: "assistant-1",
    role: "assistant",
    content: "Hi! How can I help?",
    timestamp: new Date(),
  },
];

const suggestions: Suggestion[] = [
  { title: "Summarize", message: "Summarize this chat", isLoading: false },
  { title: "Next steps", message: "List next steps", isLoading: false },
];

function createChatMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Message ${index + 1}`,
    timestamp: new Date(),
  }));
}

function mountChatView(
  props: Record<string, unknown> = {},
  slots: Parameters<typeof h>[2] = {},
) {
  return mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
    },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          {
            threadId: "thread-1",
            agentId: "default",
            labels: {
              welcomeMessageText: "Welcome to Copilot",
              chatInputPlaceholder: "Type a message...",
            },
          },
          {
            default: () => h(CopilotChatView, props, slots),
          },
        ),
    },
  });
}

describe("CopilotChatView", () => {
  it("renders welcome screen when there are no messages", () => {
    const wrapper = mountChatView({
      messages: [],
    });

    expect(
      wrapper.get("[data-testid='copilot-chat-view-welcome-screen']").text(),
    ).toContain("Welcome to Copilot");
  });

  it("can disable welcome screen for empty message threads", () => {
    const wrapper = mountChatView({
      messages: [],
      welcomeScreen: false,
    });

    expect(
      wrapper.find("[data-testid='copilot-chat-view-welcome-screen']").exists(),
    ).toBe(false);
    expect(
      wrapper
        .find("[data-testid='copilot-chat-view-input-container']")
        .exists(),
    ).toBe(true);
  });

  it("renders messages and forwards input change/submit events", async () => {
    const onSubmitMessage = vi.fn();
    const onInputChange = vi.fn();
    const wrapper = mountChatView({
      messages: chatMessages,
      onSubmitMessage,
      onInputChange,
    });

    const textarea = wrapper.get("[data-testid='copilot-chat-input-textarea']");
    await textarea.setValue("   hello from vue chat view   ");
    await textarea.trigger("keydown", { key: "Enter" });

    expect(onInputChange).toHaveBeenCalledTimes(2);
    expect(onInputChange).toHaveBeenCalledWith(
      "   hello from vue chat view   ",
    );
    expect(onSubmitMessage).toHaveBeenCalledTimes(1);
    expect(onSubmitMessage).toHaveBeenCalledWith("hello from vue chat view");

    const chatViewWrapper = wrapper.findComponent(CopilotChatView);
    expect(chatViewWrapper.emitted("input-change")).toEqual(
      expect.arrayContaining([["   hello from vue chat view   "], [""]]),
    );
    expect(chatViewWrapper.emitted("submit-message")?.at(0)).toEqual([
      "hello from vue chat view",
    ]);
  });

  it("renders suggestions and forwards selection callback and event", async () => {
    const onSelectSuggestion = vi.fn();
    const wrapper = mountChatView({
      messages: chatMessages,
      suggestions,
      onSelectSuggestion,
    });

    const suggestionButtons = wrapper.findAll(
      "[data-testid='copilot-chat-suggestion-pill']",
    );
    expect(suggestionButtons).toHaveLength(2);

    await suggestionButtons[1]?.trigger("click");

    expect(onSelectSuggestion).toHaveBeenCalledTimes(1);
    expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[1], 1);
    const chatViewWrapper = wrapper.findComponent(CopilotChatView);
    expect(chatViewWrapper.emitted("select-suggestion")?.at(0)).toEqual([
      suggestions[1],
      1,
    ]);
  });

  it("hides transcribe action when no transcribe handler is configured", () => {
    const wrapper = mountChatView({
      messages: chatMessages,
    });

    expect(
      wrapper
        .find("[data-testid='copilot-chat-input-start-transcribe']")
        .exists(),
    ).toBe(false);
  });

  it("enables transcribe action when handler is provided and emits start-transcribe", async () => {
    const onStartTranscribe = vi.fn();
    const wrapper = mountChatView({
      messages: chatMessages,
      onStartTranscribe,
    });

    const startTranscribeButton = wrapper.get(
      "[data-testid='copilot-chat-input-start-transcribe']",
    );
    await startTranscribeButton.trigger("click");

    expect(onStartTranscribe).toHaveBeenCalledTimes(1);
    const chatViewWrapper = wrapper.findComponent(CopilotChatView);
    expect(chatViewWrapper.emitted("start-transcribe")?.length).toBe(1);
  });

  it("forwards cancel/finish transcribe handlers and emits audio finish event", async () => {
    const onCancelTranscribe = vi.fn();
    const onFinishTranscribe = vi.fn();
    const onFinishTranscribeWithAudio = vi.fn();
    const wrapper = mountChatView({
      messages: chatMessages,
      inputMode: "transcribe",
      onCancelTranscribe,
      onFinishTranscribe,
      onFinishTranscribeWithAudio,
    });

    await wrapper
      .get("[data-testid='copilot-chat-input-cancel-transcribe']")
      .trigger("click");
    expect(onCancelTranscribe).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper
      .get("[data-testid='copilot-chat-input-finish-transcribe']")
      .trigger("click");
    expect(onFinishTranscribe).toHaveBeenCalledTimes(1);
    expect(onFinishTranscribeWithAudio).toHaveBeenCalledTimes(1);

    const chatViewWrapper = wrapper.findComponent(CopilotChatView);
    expect(chatViewWrapper.emitted("cancel-transcribe")?.length ?? 0).toBe(1);
    expect(chatViewWrapper.emitted("finish-transcribe")?.length ?? 0).toBe(1);
    expect(
      chatViewWrapper.emitted("finish-transcribe-with-audio"),
    ).toBeUndefined();
  });

  it("supports message-view drill-down slots for assistant and user customization", async () => {
    const wrapper = mountChatView(
      {
        messages: chatMessages,
      },
      {
        "message-view": ({
          messages,
          isRunning,
        }: {
          messages: Message[];
          isRunning: boolean;
        }) =>
          h(
            CopilotChatMessageView,
            { messages, isRunning },
            {
              "assistant-message": ({
                message,
                messages: allMessages,
                isRunning: running,
              }: {
                message: AssistantMessage;
                messages: Message[];
                isRunning: boolean;
              }) =>
                h(
                  CopilotChatAssistantMessage,
                  {
                    message,
                    messages: allMessages,
                    isRunning: running,
                    onThumbsUp: vi.fn(),
                  },
                  {
                    "copy-button": ({
                      onCopy,
                    }: {
                      onCopy: () => Promise<void>;
                    }) =>
                      h(
                        "button",
                        {
                          "data-testid": "chat-view-custom-assistant-copy",
                          onClick: onCopy,
                        },
                        "copy",
                      ),
                  },
                ),
              "user-message": ({ message }: { message: UserMessage }) =>
                h(
                  CopilotChatUserMessage,
                  { message },
                  {
                    "message-renderer": ({ content }: { content: string }) =>
                      h(
                        "div",
                        { "data-testid": "chat-view-custom-user-message" },
                        content,
                      ),
                  },
                ),
            },
          ),
      },
    );

    expect(
      wrapper.find("[data-testid='chat-view-custom-assistant-copy']").exists(),
    ).toBe(true);
    expect(
      wrapper.find("[data-testid='chat-view-custom-user-message']").text(),
    ).toBe("Hello");

    await wrapper
      .get("[data-testid='chat-view-custom-assistant-copy']")
      .trigger("click");
  });

  it("preserves scroll position when new messages arrive and the user is scrolled up", async () => {
    const messages = ref<Message[]>(createChatMessages(12));

    const Host = defineComponent({
      setup() {
        return () =>
          h(
            CopilotKitProvider,
            { runtimeUrl: "/api/copilotkit" },
            {
              default: () =>
                h(
                  CopilotChatConfigurationProvider,
                  {
                    threadId: "thread-1",
                    agentId: "default",
                  },
                  {
                    default: () =>
                      h(CopilotChatView, {
                        messages: messages.value,
                      }),
                  },
                ),
            },
          );
      },
    });

    const wrapper = mount(Host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const scrollElement = wrapper.get(
      "[data-testid='copilot-chat-view-scroll']",
    ).element as HTMLElement;

    let scrollTop = 0;
    Object.defineProperty(scrollElement, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      get: () => 300,
    });
    Object.defineProperty(scrollElement, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    scrollElement.scrollTo = ({ top }: ScrollToOptions) => {
      scrollTop = top ?? 0;
    };

    scrollTop = 120;
    scrollElement.dispatchEvent(new Event("scroll"));
    await nextTick();

    expect(
      wrapper
        .find("[data-testid='copilot-chat-view-scroll-to-bottom']")
        .exists(),
    ).toBe(true);

    messages.value = [
      ...messages.value,
      {
        id: "message-13",
        role: "assistant",
        content: "Newest message",
        timestamp: new Date(),
      },
    ];

    await nextTick();
    await nextTick();

    expect(scrollTop).toBe(120);
    expect(
      wrapper
        .find("[data-testid='copilot-chat-view-scroll-to-bottom']")
        .exists(),
    ).toBe(true);
  });
});
