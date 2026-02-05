import { describe, it, expect } from "vitest";
import { convertMessagesToEvents } from "../convert-messages-to-events";
import { EventType, Message } from "@ag-ui/client";

describe("convertMessagesToEvents", () => {
  const threadId = "test-thread";
  const runId = "test-run";

  describe("RUN_STARTED and RUN_FINISHED wrapper", () => {
    it("wraps messages with RUN_STARTED and RUN_FINISHED events", () => {
      const messages: Message[] = [];
      const events = convertMessagesToEvents(threadId, runId, messages);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe(EventType.RUN_STARTED);
      expect((events[0] as any).threadId).toBe(threadId);
      expect((events[0] as any).runId).toBe(runId);
      expect(events[1].type).toBe(EventType.RUN_FINISHED);
      expect((events[1] as any).threadId).toBe(threadId);
      expect((events[1] as any).runId).toBe(runId);
    });
  });

  describe("user messages", () => {
    it("converts user messages to TEXT_MESSAGE events", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "Hello world" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END, RUN_FINISHED
      expect(events).toHaveLength(5);
      expect(events[1].type).toBe(EventType.TEXT_MESSAGE_START);
      expect((events[1] as any).messageId).toBe("msg-1");
      expect((events[1] as any).role).toBe("user");
      expect(events[2].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect((events[2] as any).messageId).toBe("msg-1");
      expect((events[2] as any).delta).toBe("Hello world");
      expect(events[3].type).toBe(EventType.TEXT_MESSAGE_END);
      expect((events[3] as any).messageId).toBe("msg-1");
    });

    it("skips user messages without content", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // Only RUN_STARTED and RUN_FINISHED
      expect(events).toHaveLength(2);
    });
  });

  describe("system messages", () => {
    it("converts system messages to TEXT_MESSAGE events", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "system", content: "You are a helpful assistant" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      expect(events).toHaveLength(5);
      expect(events[1].type).toBe(EventType.TEXT_MESSAGE_START);
      expect((events[1] as any).role).toBe("system");
    });
  });

  describe("developer messages", () => {
    it("converts developer messages to TEXT_MESSAGE events", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "developer", content: "Developer instruction" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      expect(events).toHaveLength(5);
      expect(events[1].type).toBe(EventType.TEXT_MESSAGE_START);
      expect((events[1] as any).role).toBe("developer");
    });
  });

  describe("assistant messages", () => {
    it("converts assistant messages with content to TEXT_MESSAGE events", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "assistant", content: "Hello! How can I help?" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      expect(events).toHaveLength(5);
      expect(events[1].type).toBe(EventType.TEXT_MESSAGE_START);
      expect((events[1] as any).role).toBe("assistant");
      expect(events[2].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect((events[2] as any).delta).toBe("Hello! How can I help?");
      expect(events[3].type).toBe(EventType.TEXT_MESSAGE_END);
    });

    it("converts assistant messages with tool calls", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          toolCalls: [
            {
              id: "tool-1",
              type: "function" as const,
              function: { name: "get_weather", arguments: '{"city":"NYC"}' },
            },
          ],
        },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // RUN_STARTED, TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, RUN_FINISHED
      expect(events).toHaveLength(5);
      expect(events[1].type).toBe(EventType.TOOL_CALL_START);
      expect((events[1] as any).toolCallId).toBe("tool-1");
      expect((events[1] as any).toolCallName).toBe("get_weather");
      expect((events[1] as any).parentMessageId).toBe("msg-1");
      expect(events[2].type).toBe(EventType.TOOL_CALL_ARGS);
      expect((events[2] as any).toolCallId).toBe("tool-1");
      expect((events[2] as any).delta).toBe('{"city":"NYC"}');
      expect(events[3].type).toBe(EventType.TOOL_CALL_END);
      expect((events[3] as any).toolCallId).toBe("tool-1");
    });

    it("converts assistant messages with both content and tool calls", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          content: "Let me check the weather.",
          toolCalls: [
            {
              id: "tool-1",
              type: "function" as const,
              function: { name: "get_weather", arguments: "{}" },
            },
          ],
        },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // RUN_STARTED, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT, TEXT_MESSAGE_END,
      // TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END, RUN_FINISHED
      expect(events).toHaveLength(8);
      expect(events[1].type).toBe(EventType.TEXT_MESSAGE_START);
      expect(events[2].type).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect(events[3].type).toBe(EventType.TEXT_MESSAGE_END);
      expect(events[4].type).toBe(EventType.TOOL_CALL_START);
      expect(events[5].type).toBe(EventType.TOOL_CALL_ARGS);
      expect(events[6].type).toBe(EventType.TOOL_CALL_END);
    });

    it("converts assistant messages with multiple tool calls", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "assistant",
          toolCalls: [
            {
              id: "tool-1",
              type: "function" as const,
              function: { name: "tool_a", arguments: "{}" },
            },
            {
              id: "tool-2",
              type: "function" as const,
              function: { name: "tool_b", arguments: "{}" },
            },
          ],
        },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // RUN_STARTED, (START,ARGS,END) x2, RUN_FINISHED
      expect(events).toHaveLength(8);
      expect(events[1].type).toBe(EventType.TOOL_CALL_START);
      expect((events[1] as any).toolCallName).toBe("tool_a");
      expect(events[4].type).toBe(EventType.TOOL_CALL_START);
      expect((events[4] as any).toolCallName).toBe("tool_b");
    });
  });

  describe("tool messages", () => {
    it("converts tool messages to TOOL_CALL_RESULT events", () => {
      const messages: Message[] = [
        {
          id: "msg-1",
          role: "tool",
          content: "Sunny, 72F",
          toolCallId: "tool-1",
        },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // RUN_STARTED, TOOL_CALL_RESULT, RUN_FINISHED
      expect(events).toHaveLength(3);
      expect(events[1].type).toBe(EventType.TOOL_CALL_RESULT);
      expect((events[1] as any).messageId).toBe("msg-1");
      expect((events[1] as any).toolCallId).toBe("tool-1");
      expect((events[1] as any).content).toBe("Sunny, 72F");
      expect((events[1] as any).role).toBe("tool");
    });
  });

  describe("mixed messages", () => {
    it("converts a full conversation with multiple message types", () => {
      const messages: Message[] = [
        { id: "msg-1", role: "user", content: "What's the weather in NYC?" },
        {
          id: "msg-2",
          role: "assistant",
          content: "Let me check.",
          toolCalls: [
            {
              id: "tool-1",
              type: "function" as const,
              function: { name: "get_weather", arguments: '{"city":"NYC"}' },
            },
          ],
        },
        {
          id: "msg-3",
          role: "tool",
          content: "Sunny, 72F",
          toolCallId: "tool-1",
        },
        { id: "msg-4", role: "assistant", content: "It's sunny and 72F in NYC!" },
      ];
      const events = convertMessagesToEvents(threadId, runId, messages);

      // Verify we have all the expected events in order
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes[0]).toBe(EventType.RUN_STARTED);

      // User message
      expect(eventTypes[1]).toBe(EventType.TEXT_MESSAGE_START);
      expect(eventTypes[2]).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes[3]).toBe(EventType.TEXT_MESSAGE_END);

      // Assistant with content + tool call
      expect(eventTypes[4]).toBe(EventType.TEXT_MESSAGE_START);
      expect(eventTypes[5]).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes[6]).toBe(EventType.TEXT_MESSAGE_END);
      expect(eventTypes[7]).toBe(EventType.TOOL_CALL_START);
      expect(eventTypes[8]).toBe(EventType.TOOL_CALL_ARGS);
      expect(eventTypes[9]).toBe(EventType.TOOL_CALL_END);

      // Tool result
      expect(eventTypes[10]).toBe(EventType.TOOL_CALL_RESULT);

      // Final assistant message
      expect(eventTypes[11]).toBe(EventType.TEXT_MESSAGE_START);
      expect(eventTypes[12]).toBe(EventType.TEXT_MESSAGE_CONTENT);
      expect(eventTypes[13]).toBe(EventType.TEXT_MESSAGE_END);

      expect(eventTypes[14]).toBe(EventType.RUN_FINISHED);
    });
  });
});
