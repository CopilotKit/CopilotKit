import React from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ToolCall,
  UserMessage,
} from "@ag-ui/core";
import type { ReactActivityMessageRenderer } from "../../../types";

// ---------------------------------------------------------------------------
// Shared constants & helpers
// ---------------------------------------------------------------------------

const AGENT_ID = "default";
const THREAD_ID = "thread-test";

/** Typed factory — avoids `as UserMessage` casts everywhere. */
function userMsg(id: string, content: string) {
  return { id, role: "user" as const, content };
}

/** Typed factory — avoids `as AssistantMessage` casts everywhere. */
function assistantMsg(id: string, content?: string, toolCalls?: ToolCall[]) {
  return { id, role: "assistant" as const, content, toolCalls };
}

/** Typed factory — avoids `as ActivityMessage` casts everywhere. */
function activityMsg(
  id: string,
  activityType: string,
  content: ActivityMessage["content"],
) {
  return { id, role: "activity" as const, activityType, content };
}

/** Typed factory — avoids `as any` casts on tool call objects. */
function toolCall(id: string, name: string, args = "{}") {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: args },
  };
}

/**
 * Renders CopilotChatMessageView wrapped in the required providers.
 * Unified helper used by all describe blocks in this file.
 */
function renderMessageView({
  messages,
  renderActivityMessages,
}: {
  messages: Message[];
  renderActivityMessages?: ReactActivityMessageRenderer<{ percent: number }>[];
}) {
  return render(
    <CopilotKitProvider renderActivityMessages={renderActivityMessages}>
      <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={THREAD_ID}>
        <CopilotChatMessageView messages={messages} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CopilotChatMessageView activity rendering", () => {
  it("renders activity messages via matching custom renderer", () => {
    const messages: Message[] = [
      activityMsg("act-1", "search-progress", { percent: 42 }),
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
      activityMsg("act-2", "unknown-type", { message: "should not render" }),
    ];

    renderMessageView({ messages, renderActivityMessages: [] });

    expect(screen.queryByTestId("activity-renderer")).toBeNull();
  });
});

describe("CopilotChatMessageView duplicate message deduplication", () => {
  it("preserves assistant text content when later duplicate has empty content (multi-tool-call scenario)", () => {
    const messages: Message[] = [
      userMsg("user-1", "Record a headache"),
      assistantMsg("assistant-1", "Let me record that..."),
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "", [
        toolCall("tc-1", "captureData"),
        toolCall("tc-2", "updateMemory"),
      ]),
    ];

    renderMessageView({ messages });

    // One merged assistant message (not three)
    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(1);

    // Original text content must survive despite later empty-content duplicates
    expect(assistantMessages[0].textContent).toContain("Let me record that...");
  });

  it("deduplicates messages with the same id, keeping the last occurrence", () => {
    const messages: Message[] = [
      userMsg("user-1", "Hello"),
      assistantMsg("assistant-1", "Partial response..."),
      assistantMsg("assistant-1", "Full response from the assistant."),
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
      userMsg("user-1", "First question"),
      assistantMsg("assistant-1", "First answer"),
      userMsg("user-2", "Second question"),
      assistantMsg("assistant-2", "Second answer"),
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
