import React from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView, {
  deduplicateMessages,
} from "../CopilotChatMessageView";
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

  it("uses latest content when all assistant duplicates have non-empty content", () => {
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
    expect(assistantMessages[0].textContent).toContain(
      "Full response from the assistant.",
    );

    // Should render the user message too
    const userMessages = screen.getAllByTestId("copilot-user-message");
    expect(userMessages).toHaveLength(1);

    // Should NOT produce React duplicate key warnings. React's wording is
    // "two children with the same key" — matching "duplicate key" never fired,
    // so this assertion passed vacuously.
    const duplicateKeyWarnings = consoleSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("two children with the same key"),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("preserves order of unique messages (no duplicates)", () => {
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

describe("deduplicateMessages", () => {
  it("recovers non-empty content and keeps latest toolCalls when later duplicate clears content", () => {
    const messages: Message[] = [
      assistantMsg("assistant-1", "Let me record that..."),
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "", [
        toolCall("tc-1", "captureData"),
        toolCall("tc-2", "updateMemory"),
      ]),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    const merged = result[0] as AssistantMessage;
    // Content recovered from the first occurrence
    expect(merged.content).toBe("Let me record that...");
    // toolCalls from the latest occurrence (both tc-1 and tc-2)
    expect(merged.toolCalls).toHaveLength(2);
    expect(merged.toolCalls?.map((tc) => tc.id)).toEqual(["tc-1", "tc-2"]);
  });

  it("uses content from a later occurrence when early occurrence has empty content", () => {
    const messages: Message[] = [
      assistantMsg("assistant-1", ""),
      assistantMsg("assistant-1", "Here is the result."),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    expect((result[0] as AssistantMessage).content).toBe("Here is the result.");
  });

  it("recovers toolCalls when a later occurrence has non-empty content but undefined toolCalls", () => {
    // A later streaming chunk may carry updated content but omit toolCalls entirely.
    // The earlier accumulated toolCalls must survive rather than be wiped by the spread.
    const messages: Message[] = [
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "Here is the result."),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    const merged = result[0] as AssistantMessage;
    expect(merged.content).toBe("Here is the result.");
    expect(merged.toolCalls).toHaveLength(1);
    expect(merged.toolCalls?.[0]?.id).toBe("tc-1");
  });

  it("keeps empty toolCalls array from a later chunk (does not fall back to earlier toolCalls)", () => {
    // [] means all tool calls completed — it is an intentional value, not absence.
    // ?? must treat it as defined and keep it rather than falling back.
    const messages: Message[] = [
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "Done.", []),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    expect((result[0] as AssistantMessage).toolCalls).toEqual([]);
  });

  it("handles undefined content on both occurrences without error", () => {
    // assistantMsg with no content arg produces content: undefined.
    // undefined || undefined = undefined — should not throw or produce garbage.
    const messages: Message[] = [
      assistantMsg("assistant-1"),
      assistantMsg("assistant-1"),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    expect((result[0] as AssistantMessage).content).toBeUndefined();
  });

  it("keeps last entry for non-assistant roles", () => {
    const messages: Message[] = [
      userMsg("u-1", "Hello"),
      userMsg("u-1", "Hello (updated)"),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    expect((result[0] as UserMessage).content).toBe("Hello (updated)");
  });
});

describe("deduplicateMessages duplicate tool-call ids", () => {
  // AG-UI's TOOL_CALL_START handler appends to `toolCalls` without checking for
  // an existing entry with that id, so re-applying a start event (which the HITL
  // flow does when the run syncs after respond()) leaves a second copy carrying
  // EMPTY arguments. Rendering both showed a phantom blank approval card and
  // triggered React's "two children with the same key" warning.
  it("collapses a duplicated tool-call id on a message that was never itself duplicated", () => {
    const messages: Message[] = [
      assistantMsg("a-1", "", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
        toolCall("call_1", "openPolicyException", ""),
      ]),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    const toolCalls = (result[0] as AssistantMessage).toolCalls!;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.id).toBe("call_1");
    // The populated copy must win — the empty one is the redundant re-announce.
    expect(toolCalls[0]!.function.arguments).toBe('{"transactionId":"t-2"}');
  });

  it("prefers the populated copy regardless of which order it arrives in", () => {
    const messages: Message[] = [
      assistantMsg("a-1", "", [
        toolCall("call_1", "approveTransaction", ""),
        toolCall("call_1", "approveTransaction", '{"transactionId":"t-2"}'),
      ]),
    ];

    const toolCalls = (deduplicateMessages(messages)[0] as AssistantMessage)
      .toolCalls!;

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.function.arguments).toBe('{"transactionId":"t-2"}');
  });

  it("keeps distinct tool calls and their order", () => {
    const messages: Message[] = [
      assistantMsg("a-1", "", [
        toolCall("call_1", "first", '{"a":1}'),
        toolCall("call_2", "second", '{"b":2}'),
      ]),
    ];

    const toolCalls = (deduplicateMessages(messages)[0] as AssistantMessage)
      .toolCalls!;

    expect(toolCalls.map((t) => t.id)).toEqual(["call_1", "call_2"]);
  });

  it("collapses duplicate tool-call ids when the message is ALSO duplicated", () => {
    const messages: Message[] = [
      assistantMsg("a-1", "Working", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
      ]),
      assistantMsg("a-1", "", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
        toolCall("call_1", "openPolicyException", ""),
      ]),
    ];

    const result = deduplicateMessages(messages);

    expect(result).toHaveLength(1);
    expect((result[0] as AssistantMessage).toolCalls).toHaveLength(1);
    expect((result[0] as AssistantMessage).content).toBe("Working");
  });

  it("returns the original toolCalls array when there is nothing to collapse", () => {
    const original = [toolCall("call_1", "only", "{}")];
    const messages: Message[] = [assistantMsg("a-1", "", original)];

    // Reference equality keeps memoized consumers from re-rendering needlessly.
    expect(
      (deduplicateMessages(messages)[0] as AssistantMessage).toolCalls,
    ).toBe(original);
  });
});
