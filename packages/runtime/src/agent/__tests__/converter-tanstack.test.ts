import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  expectLifecycleWrapped,
  expectEventSequence,
  eventField,
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

      expect(eventField<string>(textEvents[0], "role")).toBe("assistant");
      expect(eventField<string>(textEvents[0], "delta")).toBe("Hello world");
      expect(eventField<string>(textEvents[0], "messageId")).toBeDefined();
      expect(typeof eventField<string>(textEvents[0], "messageId")).toBe(
        "string",
      );
      expect(
        eventField<string>(textEvents[0], "messageId").length,
      ).toBeGreaterThan(0);
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
      );
      expect(textEvents).toHaveLength(3);

      const messageIds = new Set(
        textEvents.map((e) => eventField<string>(e, "messageId")),
      );
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

      expect(eventField<string>(events[1], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[1], "toolCallName")).toBe("myTool");

      expect(eventField<string>(events[2], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[2], "delta")).toBe('{"key":');

      expect(eventField<string>(events[3], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[3], "delta")).toBe('"value"}');

      expect(eventField<string>(events[4], "toolCallId")).toBe("tc-1");
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
      )!;
      const toolStartEvent = events.find(
        (e) => e.type === EventType.TOOL_CALL_START,
      )!;

      expect(
        eventField<string>(toolStartEvent, "parentMessageId"),
      ).toBeDefined();
      expect(eventField<string>(toolStartEvent, "parentMessageId")).toBe(
        eventField<string>(textEvent, "messageId"),
      );
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
      expect(eventField<string>(events[1], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[1], "toolCallName")).toBe("toolA");

      expect(eventField<string>(events[2], "toolCallId")).toBe("tc-1");

      expect(eventField<string>(events[3], "toolCallId")).toBe("tc-1");

      // Verify second tool call
      expect(eventField<string>(events[4], "toolCallId")).toBe("tc-2");
      expect(eventField<string>(events[4], "toolCallName")).toBe("toolB");

      expect(eventField<string>(events[5], "toolCallId")).toBe("tc-2");

      expect(eventField<string>(events[6], "toolCallId")).toBe("tc-2");
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
  // Tool Call Result Events
  // -------------------------------------------------------------------------
  describe("Tool Call Result Events", () => {
    it("TOOL_CALL_RESULT chunk produces TOOL_CALL_RESULT event with correct content", async () => {
      const agent = createAgent("tanstack", [
        tanstackToolCallStart("tc-1", "myTool"),
        tanstackToolCallArgs("tc-1", '{"key":"value"}'),
        tanstackToolCallEnd("tc-1"),
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tc-1",
          content: JSON.stringify({ result: "ok" }),
        },
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectLifecycleWrapped(events);

      const resultEvents = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(resultEvents).toHaveLength(1);
      expect(eventField<string>(resultEvents[0], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(resultEvents[0], "role")).toBe("tool");
      expect(
        JSON.parse(eventField<string>(resultEvents[0], "content")),
      ).toEqual({ result: "ok" });
    });

    it("TOOL_CALL_RESULT with object content serializes to JSON", async () => {
      const agent = createAgent("tanstack", [
        tanstackToolCallStart("tc-2", "myTool"),
        tanstackToolCallEnd("tc-2"),
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tc-2",
          result: { data: 42 },
        },
      ]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      const resultEvents = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(resultEvents).toHaveLength(1);
      expect(
        JSON.parse(eventField<string>(resultEvents[0], "content")),
      ).toEqual({ data: 42 });
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
      );
      expect(eventField<string>(textEvents[0], "delta")).toBe("Let me help. ");
      expect(eventField<string>(textEvents[1], "delta")).toBe(
        "Here are the results.",
      );
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
      )!;
      expect(eventField<string>(textEvent, "delta")).toBe(largeDelta);
      expect(eventField<string>(textEvent, "delta").length).toBe(100_000);
    });
  });
});
