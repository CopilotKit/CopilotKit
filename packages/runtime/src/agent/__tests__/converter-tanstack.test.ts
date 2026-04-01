import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  expectLifecycleWrapped,
  expectEventSequence,
  tanstackTextChunk,
  tanstackToolCallStart,
  tanstackToolCallArgs,
  tanstackToolCallEnd,
} from "./agent-test-helpers";

describe("TanStack AI converter (via Agent)", () => {
  // -------------------------------------------------------------------------
  // Text Events
  // -------------------------------------------------------------------------
  describe("Text Events", () => {
    it("TEXT_MESSAGE_CONTENT chunk produces TEXT_MESSAGE_CHUNK with role assistant and correct delta", async () => {
      const agent = createAgent("tanstack", [tanstackTextChunk("Hello world")]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);

      const textEvents = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      );
      expect(textEvents).toHaveLength(1);

      const textEvent = textEvents[0] as BaseEvent & {
        role: string;
        messageId: string;
        delta: string;
      };
      expect(textEvent.role).toBe("assistant");
      expect(textEvent.delta).toBe("Hello world");
      expect(textEvent.messageId).toBeDefined();
      expect(typeof textEvent.messageId).toBe("string");
      expect(textEvent.messageId.length).toBeGreaterThan(0);
    });

    it("multiple text chunks share the same messageId", async () => {
      const agent = createAgent("tanstack", [
        tanstackTextChunk("Hello "),
        tanstackTextChunk("world"),
        tanstackTextChunk("!"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);

      const textEvents = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as (BaseEvent & { messageId: string })[];
      expect(textEvents).toHaveLength(3);

      const messageIds = new Set(textEvents.map((e) => e.messageId));
      expect(messageIds.size).toBe(1);
    });

    it("empty stream produces only RUN_STARTED + RUN_FINISHED", async () => {
      const agent = createAgent("tanstack", []);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Tool Call Events
  // -------------------------------------------------------------------------
  describe("Tool Call Events", () => {
    it("full tool call lifecycle produces START, ARGS, END events in order", async () => {
      const agent = createAgent("tanstack", [
        tanstackToolCallStart("tc-1", "myTool"),
        tanstackToolCallArgs("tc-1", '{"key":'),
        tanstackToolCallArgs("tc-1", '"value"}'),
        tanstackToolCallEnd("tc-1"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.RUN_FINISHED,
      ]);

      const startEvent = events[1] as BaseEvent & {
        toolCallId: string;
        toolCallName: string;
      };
      expect(startEvent.toolCallId).toBe("tc-1");
      expect(startEvent.toolCallName).toBe("myTool");

      const argsEvent1 = events[2] as BaseEvent & {
        toolCallId: string;
        delta: string;
      };
      expect(argsEvent1.toolCallId).toBe("tc-1");
      expect(argsEvent1.delta).toBe('{"key":');

      const argsEvent2 = events[3] as BaseEvent & {
        toolCallId: string;
        delta: string;
      };
      expect(argsEvent2.toolCallId).toBe("tc-1");
      expect(argsEvent2.delta).toBe('"value"}');

      const endEvent = events[4] as BaseEvent & { toolCallId: string };
      expect(endEvent.toolCallId).toBe("tc-1");
    });

    it("TOOL_CALL_START sets parentMessageId", async () => {
      const agent = createAgent("tanstack", [
        tanstackTextChunk("before"),
        tanstackToolCallStart("tc-1", "myTool"),
        tanstackToolCallEnd("tc-1"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      const textEvent = events.find(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as BaseEvent & { messageId: string };
      const toolStartEvent = events.find(
        (e) => e.type === EventType.TOOL_CALL_START,
      ) as BaseEvent & { parentMessageId: string };

      expect(toolStartEvent.parentMessageId).toBeDefined();
      expect(toolStartEvent.parentMessageId).toBe(textEvent.messageId);
    });

    it("multiple tool calls in sequence each get correct events", async () => {
      const agent = createAgent("tanstack", [
        tanstackToolCallStart("tc-1", "toolA"),
        tanstackToolCallArgs("tc-1", '{"a":1}'),
        tanstackToolCallEnd("tc-1"),
        tanstackToolCallStart("tc-2", "toolB"),
        tanstackToolCallArgs("tc-2", '{"b":2}'),
        tanstackToolCallEnd("tc-2"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.RUN_FINISHED,
      ]);

      // Verify first tool call
      const start1 = events[1] as BaseEvent & {
        toolCallId: string;
        toolCallName: string;
      };
      expect(start1.toolCallId).toBe("tc-1");
      expect(start1.toolCallName).toBe("toolA");

      const args1 = events[2] as BaseEvent & {
        toolCallId: string;
        delta: string;
      };
      expect(args1.toolCallId).toBe("tc-1");

      const end1 = events[3] as BaseEvent & { toolCallId: string };
      expect(end1.toolCallId).toBe("tc-1");

      // Verify second tool call
      const start2 = events[4] as BaseEvent & {
        toolCallId: string;
        toolCallName: string;
      };
      expect(start2.toolCallId).toBe("tc-2");
      expect(start2.toolCallName).toBe("toolB");

      const args2 = events[5] as BaseEvent & {
        toolCallId: string;
        delta: string;
      };
      expect(args2.toolCallId).toBe("tc-2");

      const end2 = events[6] as BaseEvent & { toolCallId: string };
      expect(end2.toolCallId).toBe("tc-2");
    });

    it("tool call with no ARGS chunks produces only START + END", async () => {
      const agent = createAgent("tanstack", [
        tanstackToolCallStart("tc-1", "noArgsTool"),
        tanstackToolCallEnd("tc-1"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_END,
        EventType.RUN_FINISHED,
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed Content
  // -------------------------------------------------------------------------
  describe("Mixed Content", () => {
    it("text interleaved with tool calls produces correct event types and order", async () => {
      const agent = createAgent("tanstack", [
        tanstackTextChunk("Let me help. "),
        tanstackToolCallStart("tc-1", "search"),
        tanstackToolCallArgs("tc-1", '{"q":"test"}'),
        tanstackToolCallEnd("tc-1"),
        tanstackTextChunk("Here are the results."),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.RUN_FINISHED,
      ]);

      // Verify content of text events
      const textEvents = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as (BaseEvent & { delta: string })[];
      expect(textEvents[0].delta).toBe("Let me help. ");
      expect(textEvents[1].delta).toBe("Here are the results.");
    });
  });

  // -------------------------------------------------------------------------
  // Edge Cases
  // -------------------------------------------------------------------------
  describe("Edge Cases", () => {
    it("unknown chunk types are silently ignored", async () => {
      const agent = createAgent("tanstack", [
        tanstackTextChunk("hello"),
        { type: "SOME_UNKNOWN_TYPE", data: "foo" },
        { type: "ANOTHER_MYSTERY", value: 42 },
        tanstackTextChunk(" world"),
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.RUN_FINISHED,
      ]);
    });

    it("large deltas (100k chars) are passed through", async () => {
      const largeDelta = "x".repeat(100_000);
      const agent = createAgent("tanstack", [tanstackTextChunk(largeDelta)]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);

      const textEvent = events.find(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as BaseEvent & { delta: string };
      expect(textEvent.delta).toBe(largeDelta);
      expect(textEvent.delta.length).toBe(100_000);
    });
  });
});
