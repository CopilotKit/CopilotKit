import { defineComponent } from "vue";
import { render, screen, fireEvent } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";

const TEST_THREAD_ID = "test-thread";

const message: AssistantMessage = {
  id: "msg-1",
  role: "assistant",
  content: "Hello from the assistant",
};

function renderWithProviders(listeners: Record<string, unknown>) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatAssistantMessage,
    },
    setup() {
      return { message, TEST_THREAD_ID, listeners };
    },
    template: `
      <CopilotKitProvider runtime-url="/api/copilotkit">
        <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
          <CopilotChatAssistantMessage
            :message="message"
            v-bind="listeners"
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  return render(Host);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CopilotChatAssistantMessage thumbs callbacks (#3457 parity)", () => {
  it("emits thumbs-up with the AssistantMessage payload, not an event", async () => {
    const onThumbsUp = vi.fn();
    renderWithProviders({ onThumbsUp });

    const thumbsUpButton = screen.getByRole("button", {
      name: /good response/i,
    });
    await fireEvent.click(thumbsUpButton);

    expect(onThumbsUp).toHaveBeenCalledTimes(1);
    const arg = onThumbsUp.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      id: "msg-1",
      role: "assistant",
      content: "Hello from the assistant",
    });
    expect(arg).not.toHaveProperty("nativeEvent");
    expect(arg).not.toHaveProperty("target");
    expect(arg).not.toHaveProperty("currentTarget");
  });

  it("emits thumbs-down with the AssistantMessage payload, not an event", async () => {
    const onThumbsDown = vi.fn();
    renderWithProviders({ onThumbsDown });

    const thumbsDownButton = screen.getByRole("button", {
      name: /bad response/i,
    });
    await fireEvent.click(thumbsDownButton);

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    const arg = onThumbsDown.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      id: "msg-1",
      role: "assistant",
      content: "Hello from the assistant",
    });
    expect(arg).not.toHaveProperty("nativeEvent");
    expect(arg).not.toHaveProperty("target");
    expect(arg).not.toHaveProperty("currentTarget");
  });
});
