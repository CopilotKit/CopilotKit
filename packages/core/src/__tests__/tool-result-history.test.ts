import type { Message, ToolMessage } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { insertToolResultMessage } from "../core/tool-result-history";
import type { ToolResultHistoryResult } from "../core/tool-result-history";

const assistant = (assistantId: string, toolCallIds: string[]): Message => ({
  id: assistantId,
  role: "assistant",
  content: "",
  toolCalls: toolCallIds.map((toolCallId) => ({
    id: toolCallId,
    type: "function",
    function: { name: toolCallId, arguments: "{}" },
  })),
});

const tool = (
  id: string,
  toolCallId: string,
  content = `result-${toolCallId}`,
): ToolMessage => ({ id, role: "tool", toolCallId, content });

describe("insertToolResultMessage", () => {
  it("inserts after the owner and its contiguous tool group", () => {
    const messages: Message[] = [
      { id: "user-1", role: "user", content: "request" },
      assistant("assistant-1", ["call-a", "call-b"]),
      tool("result-a", "call-a"),
      { id: "assistant-2", role: "assistant", content: "later" },
    ];

    const result = insertToolResultMessage(
      messages,
      tool("result-b", "call-b"),
      "assistant-1",
    );

    expect(result.status).toBe("inserted");
    expect(messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "result-a",
      "result-b",
      "assistant-2",
    ]);
  });

  it("preserves an existing result by tool call ID", () => {
    const existing = tool("real-result", "call-a", "opaque provider payload");
    const messages: Message[] = [
      assistant("assistant-1", ["call-a"]),
      existing,
    ];

    const result = insertToolResultMessage(
      messages,
      tool("replacement", "call-a", "different payload"),
      "assistant-1",
    );

    expect(result).toEqual({ status: "existing", message: existing, index: 1 });
    expect(messages).toEqual([assistant("assistant-1", ["call-a"]), existing]);
  });

  it("returns missing-owner without creating an orphan by default", () => {
    const messages: Message[] = [
      { id: "user-1", role: "user", content: "request" },
    ];

    const result = insertToolResultMessage(
      messages,
      tool("result-a", "call-a"),
    );

    expect(result).toEqual({ status: "missing-owner" });
    expect(messages).toHaveLength(1);
  });

  it("falls back to the tool-call owner when an explicit owner ID is stale", () => {
    const messages: Message[] = [assistant("assistant-1", ["call-a"])];

    const result = insertToolResultMessage(
      messages,
      tool("result-a", "call-a"),
      "missing-assistant",
    );

    expect(result.status).toBe("inserted");
    expect(messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "result-a",
    ]);
  });

  it("deduplicates by tool call when the explicit owner is stale", () => {
    const existing = tool("existing-result", "call-a");
    const messages: Message[] = [
      assistant("assistant-1", ["call-a"]),
      existing,
    ];

    expect(
      insertToolResultMessage(
        messages,
        tool("duplicate-result", "call-a", "different"),
        "missing-assistant",
      ),
    ).toEqual({ status: "existing", message: existing, index: 1 });
    expect(messages).toEqual([assistant("assistant-1", ["call-a"]), existing]);
  });

  it("appends only when the caller explicitly selects the fallback", () => {
    const messages: Message[] = [];

    const result: ToolResultHistoryResult = insertToolResultMessage(
      messages,
      tool("result-a", "call-a"),
      undefined,
      "append",
    );

    expect(result.status).toBe("inserted");
    expect(messages.map((message) => message.id)).toEqual(["result-a"]);
  });
});
