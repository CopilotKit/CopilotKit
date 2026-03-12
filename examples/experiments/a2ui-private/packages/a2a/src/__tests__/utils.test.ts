import { EventType } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import {
  convertAGUIMessagesToA2A,
  convertA2AEventToAGUIEvents,
  sendMessageToA2AAgentTool,
} from "../utils";

const createMessage = (message: Partial<Message>): Message => message as Message;

describe("convertAGUIMessagesToA2A", () => {
  it("converts AG-UI messages into A2A format while skipping system messages", () => {
    const systemMessage = createMessage({
      id: "sys-1",
      role: "system",
      content: "Follow project guidelines",
    });

    const userMessage = createMessage({
      id: "user-1",
      role: "user",
      content: [
        {
          type: "text",
          text: "Draft a project plan",
        },
      ],
    });

    const assistantMessage = createMessage({
      id: "assistant-1",
      role: "assistant",
      content: "Sure, preparing a plan",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "lookupRequirements",
            arguments: JSON.stringify({ id: 123 }),
          },
        },
      ],
    });

    const toolMessage = createMessage({
      id: "tool-1",
      role: "tool",
      toolCallId: "tool-call-1",
      content: JSON.stringify({ status: "ok" }),
    });

    const converted = convertAGUIMessagesToA2A([
      systemMessage,
      userMessage,
      assistantMessage,
      toolMessage,
    ]);

    expect(converted.contextId).toBeUndefined();
    expect(converted.history).toHaveLength(3);

    const assistantEntry = converted.history.find((entry) => entry.role === "agent");
    expect(assistantEntry?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "text", text: "Sure, preparing a plan" }),
        expect.objectContaining({ kind: "data" }),
      ]),
    );

    const toolEntry = converted.history.find((entry) =>
      entry.parts.some((part) => part.kind === "data" && (part as any).data?.type === "tool-result"),
    );
    expect(toolEntry?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "data", data: expect.objectContaining({ type: "tool-result" }) }),
      ]),
    );

    expect(converted.latestUserMessage?.role).toBe("user");
    expect(
      converted.history.some((msg) =>
        (msg.parts ?? []).some((part) =>
          part.kind === "text" && (part as any).text?.includes("Follow project guidelines"),
        ),
      ),
    ).toBe(false);
  });
});

describe("convertA2AEventToAGUIEvents", () => {
  it("produces AG-UI text chunks from A2A messages", () => {
    const a2aEvent = {
      kind: "message" as const,
      messageId: "remote-1",
      role: "agent" as const,
      parts: [
        { kind: "text" as const, text: "Hello from A2A" },
      ],
    };

    const map = new Map<string, string>();
    const events = convertA2AEventToAGUIEvents(a2aEvent, {
      messageIdMap: map,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: EventType.TEXT_MESSAGE_CHUNK,
        delta: "Hello from A2A",
      }),
    );

    expect(map.size).toBe(1);
  });

  it("maps tool-call payloads to tool events", () => {
    const a2aEvent = {
      kind: "message" as const,
      messageId: "remote-call",
      role: "agent" as const,
      parts: [
        {
          kind: "data" as const,
          data: { type: "tool-call", id: "tool-123", name: "lookup", arguments: { query: "hi" } },
        },
        {
          kind: "data" as const,
          data: { type: "tool-result", toolCallId: "tool-123", payload: { ok: true } },
        },
      ],
    };

    const events = convertA2AEventToAGUIEvents(a2aEvent, { messageIdMap: new Map() });

    expect(events).toEqual([
      expect.objectContaining({ type: EventType.TOOL_CALL_START, toolCallId: "tool-123" }),
      expect.objectContaining({ type: EventType.TOOL_CALL_ARGS, toolCallId: "tool-123" }),
      expect.objectContaining({ type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-123" }),
      expect.objectContaining({ type: EventType.TOOL_CALL_END, toolCallId: "tool-123" }),
    ]);
  });

  it("maps tool-result payloads to ToolCallResult events", () => {
    const a2aEvent = {
      kind: "message" as const,
      messageId: "remote-2",
      role: "agent" as const,
      parts: [
        {
          kind: "data" as const,
          data: { type: "tool-result", toolCallId: "call-1", payload: { ok: true } },
        },
      ],
    };

    const events = convertA2AEventToAGUIEvents(a2aEvent, { messageIdMap: new Map() });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call-1",
      }),
    );
  });

  it("maps task status updates to raw events", () => {
    const statusEvent = {
      kind: "status-update" as const,
      contextId: "ctx",
      final: false,
      status: { state: "working", message: undefined },
      taskId: "task-1",
    };

    const events = convertA2AEventToAGUIEvents(statusEvent as any, {
      messageIdMap: new Map(),
    });

    expect(events).toHaveLength(0);
  });
});

describe("sendMessageToA2AAgentTool", () => {
  it("matches the expected schema", () => {
    expect(sendMessageToA2AAgentTool.name).toBe("send_message_to_a2a_agent");
    expect(sendMessageToA2AAgentTool.parameters.required).toContain("task");
  });
});
