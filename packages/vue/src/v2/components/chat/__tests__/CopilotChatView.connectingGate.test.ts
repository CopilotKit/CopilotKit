import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import type { Suggestion } from "@copilotkit/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";

const suggestions: Suggestion[] = [
  { title: "Summarize", message: "Summarize this chat", isLoading: false },
  { title: "Next steps", message: "List next steps", isLoading: false },
];

// Minimal provider wrapper. No agent registry is required because these tests
// only exercise CopilotChatView's local render decisions (welcome-screen
// suppression and suggestion gating) that don't touch the agent runtime.
function mountChatView(props: Record<string, unknown> = {}) {
  return mount(CopilotKitProvider, {
    props: {
      runtimeUrl: "/api/copilotkit",
    },
    slots: {
      default: () =>
        h(
          CopilotChatConfigurationProvider,
          { threadId: "test-thread" },
          {
            default: () => h(CopilotChatView, props),
          },
        ),
    },
  });
}

describe("CopilotChatView connect-gating", () => {
  // Welcome-screen suppression --------------------------------------------

  it("suppresses the welcome screen while isConnecting=true", () => {
    // Switching threads would otherwise flash the welcome greeting before
    // bootstrap messages arrive.
    const wrapper = mountChatView({ messages: [], isConnecting: true });

    expect(
      wrapper.find("[data-testid='copilot-chat-view-welcome-screen']").exists(),
    ).toBe(false);
  });

  it("suppresses the welcome screen when hasExplicitThreadId=true", () => {
    // A caller-managed thread (threadId prop / config provider) should never
    // display the generic "start a new chat" welcome — even when the thread
    // has no messages yet.
    const wrapper = mountChatView({
      messages: [],
      hasExplicitThreadId: true,
    });

    expect(
      wrapper.find("[data-testid='copilot-chat-view-welcome-screen']").exists(),
    ).toBe(false);
  });

  it("shows the welcome screen by default for a fresh empty chat", () => {
    // Positive control: with no explicit thread and no connect in flight,
    // an empty chat should still render the welcome screen.
    const wrapper = mountChatView({ messages: [] });

    expect(
      wrapper.find("[data-testid='copilot-chat-view-welcome-screen']").exists(),
    ).toBe(true);
  });

  // Suggestion gating -----------------------------------------------------

  it("hides suggestions while isConnecting=true", () => {
    // Mid-bootstrap, the message tree is still assembling — rendering
    // suggestions against it would visibly snap once the final text chunk
    // lands.
    const wrapper = mountChatView({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Hi",
          timestamp: new Date(),
        },
      ],
      suggestions,
      isConnecting: true,
    });

    expect(
      wrapper.findAll("[data-testid='copilot-chat-suggestion-pill']"),
    ).toHaveLength(0);
  });

  it("hides suggestions while isRunning=true", () => {
    // Mid-run, the assistant's reply is still streaming — suggestions
    // would render against an in-flight message and reflow as deltas land.
    const wrapper = mountChatView({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Hi",
          timestamp: new Date(),
        },
      ],
      suggestions,
      isRunning: true,
    });

    expect(
      wrapper.findAll("[data-testid='copilot-chat-suggestion-pill']"),
    ).toHaveLength(0);
  });

  it("renders suggestions once isConnecting and isRunning are both false", () => {
    // Positive control: with the gates open, the suggestion pills appear.
    const wrapper = mountChatView({
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Hi",
          timestamp: new Date(),
        },
      ],
      suggestions,
    });

    expect(
      wrapper.findAll("[data-testid='copilot-chat-suggestion-pill']"),
    ).toHaveLength(suggestions.length);
  });
});
