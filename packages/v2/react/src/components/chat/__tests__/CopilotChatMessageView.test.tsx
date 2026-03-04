import React from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { vi } from "vitest";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import {
  ActivityMessage,
  AssistantMessage,
  Message,
  UserMessage,
} from "@ag-ui/core";
import { ReactActivityMessageRenderer } from "@/types";

describe("CopilotChatMessageView activity rendering", () => {
  const agentId = "default";
  const threadId = "thread-test";

  function renderMessageView({
    messages,
    renderActivityMessages,
  }: {
    messages: Message[];
    renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  }) {
    return render(
      <CopilotKitProvider renderActivityMessages={renderActivityMessages}>
        <CopilotChatConfigurationProvider agentId={agentId} threadId={threadId}>
          <CopilotChatMessageView messages={messages} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
  }

  it("renders activity messages via matching custom renderer", () => {
    const messages: Message[] = [
      {
        id: "act-1",
        role: "activity",
        activityType: "search-progress",
        content: { percent: 42 },
      } as ActivityMessage,
    ];

    const renderers: ReactActivityMessageRenderer<{ percent: number }>[] = [
      {
        activityType: "search-progress",
        content: z.object({ percent: z.number() }),
        render: ({ content }) => (
          <div data-testid="activity-renderer">
            Progress: {content.percent}%
          </div>
        ),
      },
    ];

    renderMessageView({ messages, renderActivityMessages: renderers });

    expect(screen.getByTestId("activity-renderer").textContent).toContain("42");
  });

  it("skips rendering when no activity renderer matches", () => {
    const messages: Message[] = [
      {
        id: "act-2",
        role: "activity",
        activityType: "unknown-type",
        content: { message: "should not render" },
      } as ActivityMessage,
    ];

    renderMessageView({ messages, renderActivityMessages: [] });

    expect(screen.queryByTestId("activity-renderer")).toBeNull();
  });
});

describe("CopilotChatMessageView duplicate message deduplication", () => {
  const agentId = "default";
  const threadId = "thread-test";

  function renderMessageView({ messages }: { messages: Message[] }) {
    return render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider agentId={agentId} threadId={threadId}>
          <CopilotChatMessageView messages={messages} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
  }

  it("deduplicates messages with the same id, keeping the last occurrence", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
      } as UserMessage,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Partial response...",
      } as AssistantMessage,
      {
        id: "assistant-1",
        role: "assistant",
        content: "Full response from the assistant.",
      } as AssistantMessage,
    ];

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderMessageView({ messages });

    // Should render only the last occurrence of assistant-1 (the complete one)
    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(1);

    // Should render the user message too
    const userMessages = screen.getAllByTestId("copilot-user-message");
    expect(userMessages).toHaveLength(1);

    // Should NOT produce React duplicate key warnings
    const duplicateKeyWarnings = consoleSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && call[0].includes("duplicate key"),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("preserves order of unique messages", () => {
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "First question",
      } as UserMessage,
      {
        id: "assistant-1",
        role: "assistant",
        content: "First answer",
      } as AssistantMessage,
      {
        id: "user-2",
        role: "user",
        content: "Second question",
      } as UserMessage,
      {
        id: "assistant-2",
        role: "assistant",
        content: "Second answer",
      } as AssistantMessage,
    ];

    renderMessageView({ messages });

    const userMessages = screen.getAllByTestId("copilot-user-message");
    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(userMessages).toHaveLength(2);
    expect(assistantMessages).toHaveLength(2);
  });
});
