import { describe, expect, it } from "vitest";
import type { ActivityMessage, Message, ToolCall } from "@ag-ui/core";
import { ɵdeduplicateMessages, ɵmessagesFingerprint } from "../messages";

function userMsg(id: string, content: string) {
  return { id, role: "user" as const, content };
}

function assistantMsg(id: string, content?: string, toolCalls?: ToolCall[]) {
  return { id, role: "assistant" as const, content, toolCalls };
}

function toolMsg(id: string, toolCallId: string, content: string) {
  return { id, role: "tool" as const, toolCallId, content };
}

function activityMsg(id: string, content: ActivityMessage["content"]) {
  return { id, role: "activity" as const, activityType: "progress", content };
}

function toolCall(id: string, name: string, args = "{}") {
  return {
    id,
    type: "function" as const,
    function: { name, arguments: args },
  };
}

/** Runs the dedupe and returns the single resulting assistant message. */
function dedupeToSingleAssistant(messages: Message[]) {
  const result = ɵdeduplicateMessages(messages);
  expect(result).toHaveLength(1);
  const [message] = result;
  if (message?.role !== "assistant") {
    throw new Error(`expected one assistant message, got ${message?.role}`);
  }
  return message;
}

function expectFingerprintChanges(before: Message[], after: Message[]) {
  expect(ɵmessagesFingerprint(after)).not.toBe(ɵmessagesFingerprint(before));
}

describe("ɵdeduplicateMessages", () => {
  it("recovers non-empty content and keeps latest toolCalls when later duplicate clears content", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("assistant-1", "Let me record that..."),
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "", [
        toolCall("tc-1", "captureData"),
        toolCall("tc-2", "updateMemory"),
      ]),
    ]);

    expect(merged.content).toBe("Let me record that...");
    expect(merged.toolCalls?.map((tc) => tc.id)).toEqual(["tc-1", "tc-2"]);
  });

  it("uses content from a later occurrence when early occurrence has empty content", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("assistant-1", ""),
      assistantMsg("assistant-1", "Here is the result."),
    ]);

    expect(merged.content).toBe("Here is the result.");
  });

  it("recovers toolCalls when a later occurrence has non-empty content but undefined toolCalls", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "Here is the result."),
    ]);

    expect(merged.content).toBe("Here is the result.");
    expect(merged.toolCalls?.map((tc) => tc.id)).toEqual(["tc-1"]);
  });

  it("keeps an empty toolCalls array from a later chunk", () => {
    // [] means all tool calls completed. It is a value, not an absence.
    const merged = dedupeToSingleAssistant([
      assistantMsg("assistant-1", "", [toolCall("tc-1", "captureData")]),
      assistantMsg("assistant-1", "Done.", []),
    ]);

    expect(merged.toolCalls).toEqual([]);
  });

  it("handles undefined content on both occurrences", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("assistant-1"),
      assistantMsg("assistant-1"),
    ]);

    expect(merged.content).toBeUndefined();
  });

  it("keeps the last entry for non-assistant roles", () => {
    const result = ɵdeduplicateMessages([
      userMsg("u-1", "Hello"),
      userMsg("u-1", "Hello (updated)"),
    ]);

    expect(result).toEqual([userMsg("u-1", "Hello (updated)")]);
  });

  it("keeps each id at the position where it first appears", () => {
    const result = ɵdeduplicateMessages([
      assistantMsg("a-1", "first"),
      userMsg("u-1", "question"),
      assistantMsg("a-1", "first, longer"),
    ]);

    expect(result.map((m) => m.id)).toEqual(["a-1", "u-1"]);
  });

  it("returns a message that needed no change as the same object", () => {
    const user = userMsg("u-1", "Hello");
    const assistant = assistantMsg("a-1", "", [toolCall("call_1", "only")]);

    const result = ɵdeduplicateMessages([user, assistant]);

    expect(result[0]).toBe(user);
    expect(result[1]).toBe(assistant);
  });
});

describe("ɵdeduplicateMessages duplicate tool-call ids", () => {
  // AG-UI's TOOL_CALL_START handler appends to `toolCalls` without checking for
  // an existing entry with that id. Re-applying a start event (the HITL flow
  // does this when the run syncs after respond()) leaves a second copy with
  // empty arguments.
  it("collapses a double TOOL_CALL_START on a message that was never itself duplicated", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
        toolCall("call_1", "openPolicyException", ""),
      ]),
    ]);

    expect(merged.toolCalls).toEqual([
      toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
    ]);
  });

  it("prefers the copy with arguments when it arrives second", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "", [
        toolCall("call_1", "approveTransaction", ""),
        toolCall("call_1", "approveTransaction", '{"transactionId":"t-2"}'),
      ]),
    ]);

    expect(merged.toolCalls).toEqual([
      toolCall("call_1", "approveTransaction", '{"transactionId":"t-2"}'),
    ]);
  });

  it("keeps one copy when a double TOOL_CALL_START has no arguments yet", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "", [
        toolCall("call_1", "approveTransaction", ""),
        toolCall("call_1", "approveTransaction", ""),
      ]),
    ]);

    expect(merged.toolCalls).toEqual([
      toolCall("call_1", "approveTransaction", ""),
    ]);
  });

  it("keeps distinct tool calls and their order while collapsing a repeat", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "", [
        toolCall("call_1", "first", ""),
        toolCall("call_2", "second", '{"b":2}'),
        toolCall("call_1", "first", '{"a":1}'),
      ]),
    ]);

    expect(merged.toolCalls).toEqual([
      toolCall("call_1", "first", '{"a":1}'),
      toolCall("call_2", "second", '{"b":2}'),
    ]);
  });

  it("collapses duplicate tool-call ids when the message is also duplicated", () => {
    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "Working", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
      ]),
      assistantMsg("a-1", "", [
        toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
        toolCall("call_1", "openPolicyException", ""),
      ]),
    ]);

    expect(merged.content).toBe("Working");
    expect(merged.toolCalls).toEqual([
      toolCall("call_1", "openPolicyException", '{"transactionId":"t-2"}'),
    ]);
  });

  it("returns the original toolCalls array when there is nothing to collapse", () => {
    const original = [toolCall("call_1", "only")];

    const merged = dedupeToSingleAssistant([
      assistantMsg("a-1", "Hi"),
      assistantMsg("a-1", "", original),
    ]);

    // Reference equality keeps memoized consumers from re-rendering.
    expect(merged.toolCalls).toBe(original);
  });
});

describe("ɵmessagesFingerprint", () => {
  it("changes when assistant text grows", () => {
    expectFingerprintChanges(
      [assistantMsg("a-1", "Hel")],
      [assistantMsg("a-1", "Hello")],
    );
  });

  it("changes when tool-call arguments grow", () => {
    expectFingerprintChanges(
      [assistantMsg("a-1", "", [toolCall("call_1", "search", '{"q":')])],
      [assistantMsg("a-1", "", [toolCall("call_1", "search", '{"q":"x"}')])],
    );
  });

  it("changes when a tool call is added", () => {
    expectFingerprintChanges(
      [assistantMsg("a-1", "", [toolCall("call_1", "search")])],
      [
        assistantMsg("a-1", "", [
          toolCall("call_1", "search"),
          toolCall("call_2", "search"),
        ]),
      ],
    );
  });

  it("changes when a tool message points at another tool call", () => {
    expectFingerprintChanges(
      [toolMsg("t-1", "call_1", "ok")],
      [toolMsg("t-1", "call_2", "ok")],
    );
  });

  it("changes when activity content is replaced under the same id", () => {
    expectFingerprintChanges(
      [activityMsg("act-1", { step: 1 })],
      [activityMsg("act-1", { step: 2 })],
    );
  });

  it("changes when a multimodal part is added", () => {
    const text = { type: "text" as const, text: "look" };
    expectFingerprintChanges(
      [{ id: "u-1", role: "user", content: [text] }],
      [{ id: "u-1", role: "user", content: [text, text] }],
    );
  });

  it("does not throw on circular content and still tracks the other messages", () => {
    const circular: Record<string, unknown> = { step: 1 };
    circular.self = circular;
    const before = [activityMsg("act-1", circular), assistantMsg("a-1", "Hi")];

    expect(() => ɵmessagesFingerprint(before)).not.toThrow();
    expectFingerprintChanges(before, [
      activityMsg("act-1", circular),
      assistantMsg("a-1", "Hi there"),
    ]);
  });
});
