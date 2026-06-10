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

    // Should NOT produce React duplicate key warnings
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

describe("CopilotChatMessageView stable row keying across message id changes", () => {
  /**
   * Tree builder (not renderMessageView) so tests can `rerender` the same
   * component instance — remount-vs-reconcile is only observable across a
   * rerender of one root.
   */
  function messageViewTree(messages: Message[]) {
    return (
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider
          agentId={AGENT_ID}
          threadId={THREAD_ID}
        >
          <CopilotChatMessageView messages={messages} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  }

  function rerenderWithIdSwap(before: Message[], after: Message[]) {
    const view = render(messageViewTree(before));
    const node = screen.getByTestId("copilot-assistant-message");
    view.rerender(messageViewTree(after));
    return { node, nodeAfter: screen.getByTestId("copilot-assistant-message") };
  }

  it("reconciles the row in place when the message id changes but the tool-call id is stable", () => {
    const { node, nodeAfter } = rerenderWithIdSwap(
      [assistantMsg("lc_run--1", "Working...", [toolCall("tc-1", "approve")])],
      [assistantMsg("resp_1", "Done", [toolCall("tc-1", "approve")])],
    );

    expect(nodeAfter).toBe(node);
    // Content update must flow through the memoized component — proves React
    // reconciled in place AND re-rendered, not just kept a stale DOM node.
    expect(nodeAfter.textContent).toContain("Done");
  });

  // Documents the current limitation: text-only assistant messages have no
  // stable anchor across an id rename, so the row remounts. This is not a
  // contract — if a future change provides a stable anchor for such rows,
  // update this test to assert in-place reconcile rather than reverting.
  it("remounts the row on an id change when the message has no tool-call anchor", () => {
    const { node, nodeAfter } = rerenderWithIdSwap(
      [assistantMsg("lc_run--1", "Working...")],
      [assistantMsg("resp_1", "Done")],
    );

    expect(nodeAfter).not.toBe(node);
  });

  it("remounts the row on an id change when toolCalls is an empty array (no anchor available)", () => {
    // toolCalls: [] (explicit empty) means no first tool-call id exists, so
    // the row falls back to id keying — pins the ?.[0]?.id fallback behavior.
    const { node, nodeAfter } = rerenderWithIdSwap(
      [assistantMsg("lc_run--1", "Working...", [])],
      [assistantMsg("resp_1", "Done", [])],
    );

    expect(nodeAfter).not.toBe(node);
  });

  it("falls back to message.id when two assistant messages share a first tool-call id (no duplicate keys)", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const messages: Message[] = [
      assistantMsg("a-1", "First", [toolCall("tc-1", "approve")]),
      assistantMsg("a-2", "Second", [toolCall("tc-1", "approve")]),
    ];

    render(messageViewTree(messages));

    // Both assistant rows must render — duplicate React keys can cause React
    // to reconcile a row with the wrong DOM node and inherit stale state; the
    // warning-count assertion below is the actual safety net.
    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(2);

    // Render order matches input order — pins first-claimant-wins precedence
    // so the first occurrence keeps `tc:<id>` and the second falls back to id.
    expect(assistantMessages[0].textContent).toContain("First");
    expect(assistantMessages[1].textContent).toContain("Second");

    // No React "two children with the same key" warning should fire.
    const duplicateKeyWarnings = consoleSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("two children with the same key"),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it("keeps row keys unique when a literal message id collides with an earlier tc:-prefixed key", () => {
    // Pathological: a backend emits a message id that literally starts with
    // "tc:" and matches an earlier assistant's first tool-call id. The
    // structural uniqueness guard in buildRowRenderKeys must disambiguate.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const messages: Message[] = [
      assistantMsg("a-1", "First", [toolCall("tc-1", "approve")]),
      assistantMsg("tc:tc-1", "Second"),
    ];

    render(messageViewTree(messages));

    const assistantMessages = screen.getAllByTestId(
      "copilot-assistant-message",
    );
    expect(assistantMessages).toHaveLength(2);

    const duplicateKeyWarnings = consoleSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" &&
        call[0].includes("two children with the same key"),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);

    consoleSpy.mockRestore();
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
