import { defineComponent, h } from "vue";
import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Message, ToolCall } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import type { VueActivityMessageRenderer } from "../../../types";

const agentId = "default";
const threadId = "thread-test";

/** Slot templates that print what the view hands each message slot. */
const assistantContentSlot = `
  <template #assistant-message="{ message }">
    <div data-testid="assistant-content">{{ message.content }}</div>
  </template>`;
const assistantToolCallsSlot = `
  <template #assistant-message="{ message }">
    <div data-testid="assistant-tool-calls-count">{{ message.toolCalls?.length ?? 0 }}</div>
    <div data-testid="assistant-tool-call-args">{{ (message.toolCalls ?? []).map((call) => call.function.arguments).join("|") }}</div>
    <div data-testid="assistant-content">{{ message.content }}</div>
  </template>`;
const userContentSlot = `
  <template #user-message="{ message }">
    <div data-testid="user-content">{{ message.content }}</div>
  </template>`;

/**
 * Renders a message view inside the providers.
 *
 * @param options.slots - Slot templates placed inside the message view.
 * @param options.renderActivityMessages - Activity renderers to register.
 */
function renderMessageView(options: {
  messages: Message[];
  slots?: string;
  renderActivityMessages?: VueActivityMessageRenderer<unknown>[];
}) {
  const { messages, slots = "", renderActivityMessages = [] } = options;
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChatMessageView,
    },
    setup() {
      return { messages, agentId, threadId, renderActivityMessages };
    },
    template: `
      <CopilotKitProvider
        runtime-url="/api/copilotkit"
        :render-activity-messages="renderActivityMessages"
      >
        <CopilotChatConfigurationProvider :agent-id="agentId" :thread-id="threadId">
          <CopilotChatMessageView :messages="messages">${slots}</CopilotChatMessageView>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

function toolCall(id: string, name: string, args = "{}"): ToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

describe("CopilotChatMessageView activity rendering", () => {
  const progress: Message = {
    id: "act-1",
    role: "activity",
    activityType: "search-progress",
    content: { percent: 42 },
  };

  /** A `"*"` renderer that prints the content it was given. */
  const wildcardRenderer: VueActivityMessageRenderer<unknown> = {
    activityType: "*",
    content: z.object({ percent: z.number() }),
    render: (props) =>
      h(
        "div",
        { "data-testid": "wildcard-activity" },
        JSON.stringify(props.content),
      ),
  };

  it("renders activity messages through their activity-<type> slot", () => {
    renderMessageView({
      messages: [progress],
      slots: `
        <template #activity-search-progress="{ content }">
          <div data-testid="activity-renderer">Progress: {{ content.percent }}%</div>
        </template>`,
    });

    expect(screen.getByTestId("activity-renderer").textContent).toContain("42");
  });

  it("skips rendering when no activity renderer matches", () => {
    renderMessageView({
      messages: [
        {
          id: "act-2",
          role: "activity",
          activityType: "unknown-type",
          content: { message: "should not render" },
        },
      ],
    });

    expect(screen.queryByText("should not render")).toBeNull();
  });

  it("falls back to the * renderer for a type with no renderer of its own", () => {
    renderMessageView({
      messages: [progress],
      renderActivityMessages: [wildcardRenderer],
    });

    expect(screen.getByTestId("wildcard-activity").textContent).toBe(
      '{"percent":42}',
    );
  });

  it("uses an activity-<type> slot before the * renderer", () => {
    renderMessageView({
      messages: [progress],
      renderActivityMessages: [wildcardRenderer],
      slots: `
        <template #activity-search-progress>
          <div data-testid="activity-slot">slot</div>
        </template>`,
    });

    expect(screen.getByTestId("activity-slot")).toBeTruthy();
    expect(screen.queryByTestId("wildcard-activity")).toBeNull();
  });
});

describe("CopilotChatMessageView duplicate message deduplication", () => {
  it("preserves assistant text content when later duplicate has empty content (multi-tool-call scenario)", () => {
    renderMessageView({
      messages: [
        { id: "user-1", role: "user", content: "Record a headache" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Let me record that...",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          toolCalls: [toolCall("tc-1", "captureData")],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          toolCalls: [
            toolCall("tc-1", "captureData"),
            toolCall("tc-2", "updateMemory"),
          ],
        },
      ],
    });

    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.textContent).toContain(
      "Let me record that...",
    );
  });

  it("uses latest content when all assistant duplicates have non-empty content", () => {
    renderMessageView({
      messages: [
        { id: "user-1", role: "user", content: "Hello" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Partial response...",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Full response from the assistant.",
        },
      ],
    });

    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.textContent).toContain(
      "Full response from the assistant.",
    );
    expect(screen.getAllByTestId("copilot-user-message")).toHaveLength(1);
  });

  it("uses later content when earlier content is empty", () => {
    renderMessageView({
      messages: [
        { id: "assistant-1", role: "assistant", content: "" },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Here is the result.",
        },
      ],
      slots: assistantContentSlot,
    });

    expect(screen.getByTestId("assistant-content").textContent).toContain(
      "Here is the result.",
    );
  });

  it("recovers toolCalls when later duplicate has content but undefined toolCalls", () => {
    renderMessageView({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          toolCalls: [toolCall("tc-1", "captureData")],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Here is the result.",
        },
      ],
      slots: assistantToolCallsSlot,
    });

    expect(screen.getByTestId("assistant-content").textContent).toContain(
      "Here is the result.",
    );
    expect(screen.getByTestId("assistant-tool-calls-count").textContent).toBe(
      "1",
    );
  });

  it("keeps empty toolCalls array from later chunk", () => {
    renderMessageView({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          toolCalls: [toolCall("tc-1", "captureData")],
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Done.",
          toolCalls: [],
        },
      ],
      slots: assistantToolCallsSlot,
    });

    expect(screen.getByTestId("assistant-tool-calls-count").textContent).toBe(
      "0",
    );
  });

  it("collapses a tool call that repeats in one message, keeping the copy with arguments", () => {
    renderMessageView({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          toolCalls: [
            toolCall("tc-1", "getWeather", '{"city":"Paris"}'),
            toolCall("tc-1", "getWeather", ""),
          ],
        },
      ],
      slots: assistantToolCallsSlot,
    });

    expect(screen.getByTestId("assistant-tool-calls-count").textContent).toBe(
      "1",
    );
    expect(screen.getByTestId("assistant-tool-call-args").textContent).toBe(
      '{"city":"Paris"}',
    );
  });

  it("handles undefined content on both occurrences", () => {
    renderMessageView({
      messages: [
        { id: "assistant-1", role: "assistant", content: undefined },
        { id: "assistant-1", role: "assistant", content: undefined },
      ],
      slots: assistantContentSlot,
    });

    expect(screen.getByTestId("assistant-content").textContent).toBe("");
  });

  it("keeps last entry for non-assistant roles", () => {
    renderMessageView({
      messages: [
        { id: "user-1", role: "user", content: "Hello" },
        { id: "user-1", role: "user", content: "Hello (updated)" },
      ],
      slots: userContentSlot,
    });

    expect(screen.getByTestId("user-content").textContent).toBe(
      "Hello (updated)",
    );
  });

  it("preserves order of unique messages", () => {
    renderMessageView({
      messages: [
        { id: "user-1", role: "user", content: "First question" },
        { id: "assistant-1", role: "assistant", content: "First answer" },
        { id: "user-2", role: "user", content: "Second question" },
        { id: "assistant-2", role: "assistant", content: "Second answer" },
      ],
    });

    expect(screen.getAllByTestId("copilot-user-message")).toHaveLength(2);
    expect(screen.getAllByTestId("copilot-assistant-message")).toHaveLength(2);
  });
});
