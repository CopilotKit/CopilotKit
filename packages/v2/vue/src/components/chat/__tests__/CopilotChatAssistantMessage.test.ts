import { describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { AssistantMessage, Message } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { CopilotChatDefaultLabels } from "../../../providers/types";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";

function mountAssistantMessage(
  message: AssistantMessage,
  options?: {
    messages?: Message[];
    isRunning?: boolean;
    onThumbsUp?: (message: AssistantMessage) => void;
    onThumbsDown?: (message: AssistantMessage) => void;
    onReadAloud?: (message: AssistantMessage) => void;
    onRegenerate?: (message: AssistantMessage) => void;
  },
) {
  return mount(CopilotKitProvider, {
    props: { runtimeUrl: "/api/copilotkit" },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "thread-1", agentId: "default" },
          {
            default: () =>
              h(CopilotChatAssistantMessage, {
                message,
                messages: options?.messages ?? [message],
                isRunning: options?.isRunning ?? false,
                onThumbsUp: options?.onThumbsUp,
                onThumbsDown: options?.onThumbsDown,
                onReadAloud: options?.onReadAloud,
                onRegenerate: options?.onRegenerate,
              }),
          },
        ),
    },
  });
}

describe("CopilotChatAssistantMessage", () => {
  it("renders assistant content and copy button", () => {
    const message: AssistantMessage = {
      id: "assistant-1",
      role: "assistant",
      content: "Hello from assistant",
      timestamp: new Date(),
    };

    const wrapper = mountAssistantMessage(message);

    expect(wrapper.text()).toContain("Hello from assistant");
    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel}"]`,
        )
        .exists(),
    ).toBe(true);
  });

  it("renders feedback toolbar buttons only when callbacks are provided", async () => {
    const message: AssistantMessage = {
      id: "assistant-2",
      role: "assistant",
      content: "Feedback test",
      timestamp: new Date(),
    };

    const onThumbsUp = vi.fn();
    const wrapper = mountAssistantMessage(message, { onThumbsUp });

    const thumbsUpButton = wrapper.find(
      `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarThumbsUpLabel}"]`,
    );
    expect(thumbsUpButton.exists()).toBe(true);

    await thumbsUpButton.trigger("click");
    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    expect(onThumbsUp).toHaveBeenCalledWith(message);

    const assistantMessageWrapper = wrapper.findComponent(
      CopilotChatAssistantMessage,
    );
    expect(assistantMessageWrapper.emitted("thumbs-up")?.length).toBe(1);
    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarThumbsDownLabel}"]`,
        )
        .exists(),
    ).toBe(false);
  });

  it("hides toolbar when latest assistant message is running", () => {
    const message: AssistantMessage = {
      id: "assistant-3",
      role: "assistant",
      content: "Generating...",
      timestamp: new Date(),
    };

    const wrapper = mountAssistantMessage(message, {
      messages: [message],
      isRunning: true,
      onThumbsUp: vi.fn(),
    });

    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel}"]`,
        )
        .exists(),
    ).toBe(false);
  });

  it("does not render toolbar for empty content-only messages", () => {
    const message: AssistantMessage = {
      id: "assistant-4",
      role: "assistant",
      content: "   ",
      timestamp: new Date(),
    };

    const wrapper = mountAssistantMessage(message, { onThumbsUp: vi.fn() });

    expect(
      wrapper
        .find(
          `[aria-label="${CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel}"]`,
        )
        .exists(),
    ).toBe(false);
  });

  it("renders markdown lists and fenced code blocks", () => {
    const message: AssistantMessage = {
      id: "assistant-5",
      role: "assistant",
      content: `Here is a quick summary:

- **First** item
- \`Second\` item

\`\`\`ts
const value = 1;
\`\`\``,
      timestamp: new Date(),
    };

    const wrapper = mountAssistantMessage(message);

    expect(wrapper.find("ul li").exists()).toBe(true);
    expect(wrapper.find("strong").text()).toBe("First");
    expect(wrapper.find('[data-streamdown="code-block"]').exists()).toBe(true);
    expect(
      wrapper.find('[data-streamdown="code-lang"]').text().toLowerCase(),
    ).toBe("ts");
  });

  it("renders markdown image and table actions", () => {
    const message: AssistantMessage = {
      id: "assistant-6",
      role: "assistant",
      content: `![Alt text](https://example.com/image.png)

| Feature | Supported |
| --- | --- |
| Tables | ✅ |`,
      timestamp: new Date(),
    };

    const wrapper = mountAssistantMessage(message);

    expect(wrapper.find('button[title="Download image"]').exists()).toBe(true);
    expect(wrapper.find("table").exists()).toBe(true);
    expect(wrapper.find('button[title="Copy table"]').exists()).toBe(true);
    expect(wrapper.find('button[title="Download table"]').exists()).toBe(true);
  });

  it("supports custom message-renderer and toolbar slots", async () => {
    const message: AssistantMessage = {
      id: "assistant-7",
      role: "assistant",
      content: "Render me with slots",
      timestamp: new Date(),
    };
    const onThumbsUp = vi.fn();

    const wrapper = mountAssistantMessage(message, {
      onThumbsUp,
      onThumbsDown: vi.fn(),
    });

    const wrapped = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h(
                  CopilotChatAssistantMessage,
                  {
                    message,
                    messages: [message],
                    onThumbsUp,
                    onThumbsDown: vi.fn(),
                  },
                  {
                    "message-renderer": ({ content }: { content: string }) =>
                      h(
                        "div",
                        { "data-testid": "custom-assistant-renderer" },
                        `slot:${content}`,
                      ),
                    toolbar: ({
                      shouldShowToolbar,
                    }: {
                      shouldShowToolbar: boolean;
                    }) =>
                      h(
                        "div",
                        { "data-testid": "custom-assistant-toolbar" },
                        String(shouldShowToolbar),
                      ),
                  },
                ),
            },
          ),
      },
    });

    expect(
      wrapper.find('[data-testid="custom-assistant-renderer"]').exists(),
    ).toBe(false);
    expect(
      wrapped.get("[data-testid='custom-assistant-renderer']").text(),
    ).toBe("slot:Render me with slots");
    expect(wrapped.get("[data-testid='custom-assistant-toolbar']").text()).toBe(
      "true",
    );
  });

  it("supports custom toolbar button slots and forwards actions", async () => {
    const message: AssistantMessage = {
      id: "assistant-8",
      role: "assistant",
      content: "Button slot test",
      timestamp: new Date(),
    };
    const onThumbsUp = vi.fn();
    const onThumbsDown = vi.fn();
    const onReadAloud = vi.fn();
    const onRegenerate = vi.fn();

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h(
                  CopilotChatAssistantMessage,
                  {
                    message,
                    messages: [message],
                    onThumbsUp,
                    onThumbsDown,
                    onReadAloud,
                    onRegenerate,
                  },
                  {
                    "copy-button": ({
                      onCopy,
                    }: {
                      onCopy: () => Promise<void>;
                    }) =>
                      h(
                        "button",
                        { "data-testid": "custom-copy", onClick: onCopy },
                        "copy",
                      ),
                    "thumbs-up-button": ({
                      onThumbsUp: onClick,
                    }: {
                      onThumbsUp: () => void;
                    }) =>
                      h(
                        "button",
                        { "data-testid": "custom-thumbs-up", onClick },
                        "up",
                      ),
                    "thumbs-down-button": ({
                      onThumbsDown: onClick,
                    }: {
                      onThumbsDown: () => void;
                    }) =>
                      h(
                        "button",
                        { "data-testid": "custom-thumbs-down", onClick },
                        "down",
                      ),
                    "read-aloud-button": ({
                      onReadAloud: onClick,
                    }: {
                      onReadAloud: () => void;
                    }) =>
                      h(
                        "button",
                        { "data-testid": "custom-read", onClick },
                        "read",
                      ),
                    "regenerate-button": ({
                      onRegenerate: onClick,
                    }: {
                      onRegenerate: () => void;
                    }) =>
                      h(
                        "button",
                        { "data-testid": "custom-regenerate", onClick },
                        "regen",
                      ),
                  },
                ),
            },
          ),
      },
    });

    await wrapper.get("[data-testid='custom-copy']").trigger("click");
    await wrapper.get("[data-testid='custom-thumbs-up']").trigger("click");
    await wrapper.get("[data-testid='custom-thumbs-down']").trigger("click");
    await wrapper.get("[data-testid='custom-read']").trigger("click");
    await wrapper.get("[data-testid='custom-regenerate']").trigger("click");

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    expect(onThumbsUp).toHaveBeenCalledWith(message);
    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(onThumbsDown).toHaveBeenCalledWith(message);
    expect(onReadAloud).toHaveBeenCalledTimes(1);
    expect(onReadAloud).toHaveBeenCalledWith(message);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onRegenerate).toHaveBeenCalledWith(message);
  });

  it("supports custom tool-calls-view slot", () => {
    const message: AssistantMessage = {
      id: "assistant-9",
      role: "assistant",
      content: "Tool call slot",
      timestamp: new Date(),
      toolCalls: [
        {
          id: "tool-slot-1",
          type: "function",
          function: {
            name: "search_docs",
            arguments: JSON.stringify({ query: "slot" }),
          },
        },
      ],
    };

    const wrapper = mount(CopilotKitProvider, {
      props: { runtimeUrl: "/api/copilotkit" },
      slots: {
        default: () =>
          h(
            CopilotChatConfigurationProvider,
            { threadId: "thread-1", agentId: "default" },
            {
              default: () =>
                h(
                  CopilotChatAssistantMessage,
                  {
                    message,
                    messages: [message],
                  },
                  {
                    "tool-calls-view": ({
                      message: slotMessage,
                    }: {
                      message: AssistantMessage;
                    }) =>
                      h(
                        "div",
                        { "data-testid": "custom-tool-calls-view" },
                        slotMessage.id,
                      ),
                  },
                ),
            },
          ),
      },
    });

    expect(wrapper.get("[data-testid='custom-tool-calls-view']").text()).toBe(
      "assistant-9",
    );
  });
});
