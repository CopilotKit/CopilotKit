import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  expectLifecycleWrapped,
  expectEventSequence,
  textStart,
  textDelta,
  toolCallStreamingStart,
  toolCallDelta,
  toolCall,
  toolResult,
  reasoningStart,
  reasoningDelta,
  reasoningEnd,
  finish,
} from "./agent-test-helpers";

// ---------------------------------------------------------------------------
// Basic Event Emission
// ---------------------------------------------------------------------------

describe("AI SDK Converter", () => {
  describe("Basic Event Emission", () => {
    it("text delta emits TEXT_MESSAGE_CHUNK with correct role, messageId, and delta", async () => {
      const agent = createAgent("aisdk", [textDelta("Hello"), finish()]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      const textChunks = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      );
      expect(textChunks).toHaveLength(1);

      const chunk = textChunks[0] as BaseEvent & {
        role: string;
        messageId: string;
        delta: string;
      };
      expect(chunk.role).toBe("assistant");
      expect(chunk.delta).toBe("Hello");
      expect(chunk.messageId).toBeDefined();
      expect(typeof chunk.messageId).toBe("string");
    });

    it("text-start with provider id uses that id as messageId", async () => {
      const agent = createAgent("aisdk", [
        textStart("custom-msg-id"),
        textDelta("Hi"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const chunk = events.find(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as BaseEvent & { messageId: string };
      expect(chunk.messageId).toBe("custom-msg-id");
    });

    it('text-start with "0" generates a unique messageId (not "0")', async () => {
      const agent = createAgent("aisdk", [
        textStart("0"),
        textDelta("Hi"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const chunk = events.find(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as BaseEvent & { messageId: string };
      expect(chunk.messageId).not.toBe("0");
      expect(chunk.messageId).toBeDefined();
      expect(chunk.messageId.length).toBeGreaterThan(0);
    });

    it("multiple text deltas share the same messageId", async () => {
      const agent = createAgent("aisdk", [
        textDelta("Hello "),
        textDelta("world"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const textChunks = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as (BaseEvent & { messageId: string })[];
      expect(textChunks).toHaveLength(2);
      expect(textChunks[0].messageId).toBe(textChunks[1].messageId);
    });

    it("empty stream (only finish) emits only RUN_STARTED + RUN_FINISHED", async () => {
      const agent = createAgent("aisdk", [finish()]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Call Events
  // ---------------------------------------------------------------------------

  describe("Tool Call Events", () => {
    it("streamed tool call emits correct START/ARGS/END/RESULT events", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-1", "myTool"),
        toolCallDelta("tc-1", '{"key":'),
        toolCallDelta("tc-1", '"value"}'),
        toolCall("tc-1", "myTool"),
        toolResult("tc-1", "myTool", { result: "ok" }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      // Check the sequence of tool events
      const toolEvents = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START ||
          e.type === EventType.TOOL_CALL_ARGS ||
          e.type === EventType.TOOL_CALL_END ||
          e.type === EventType.TOOL_CALL_RESULT,
      );

      expectEventSequence(toolEvents, [
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.TOOL_CALL_RESULT,
      ]);

      // Verify TOOL_CALL_START details
      const startEvt = toolEvents[0] as BaseEvent & {
        toolCallId: string;
        toolCallName: string;
      };
      expect(startEvt.toolCallId).toBe("tc-1");
      expect(startEvt.toolCallName).toBe("myTool");

      // Verify TOOL_CALL_ARGS deltas
      const argsEvts = toolEvents.filter(
        (e) => e.type === EventType.TOOL_CALL_ARGS,
      ) as (BaseEvent & { delta: string })[];
      expect(argsEvts[0].delta).toBe('{"key":');
      expect(argsEvts[1].delta).toBe('"value"}');

      // Verify TOOL_CALL_END
      const endEvt = toolEvents[2 + 1] as BaseEvent & { toolCallId: string };
      expect(endEvt.toolCallId).toBe("tc-1");

      // Verify TOOL_CALL_RESULT
      const resultEvt = toolEvents[4] as BaseEvent & {
        toolCallId: string;
        content: string;
      };
      expect(resultEvt.toolCallId).toBe("tc-1");
      expect(JSON.parse(resultEvt.content)).toEqual({ result: "ok" });
    });

    it("non-streamed tool call (tool-call with input, no prior tool-input-start) emits START + ARGS + END", async () => {
      const agent = createAgent("aisdk", [
        toolCall("tc-2", "directTool", { foo: "bar" }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      const toolEvents = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START ||
          e.type === EventType.TOOL_CALL_ARGS ||
          e.type === EventType.TOOL_CALL_END,
      );

      expectEventSequence(toolEvents, [
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
      ]);

      const startEvt = toolEvents[0] as BaseEvent & {
        toolCallName: string;
        toolCallId: string;
      };
      expect(startEvt.toolCallId).toBe("tc-2");
      expect(startEvt.toolCallName).toBe("directTool");

      const argsEvt = toolEvents[1] as BaseEvent & { delta: string };
      expect(JSON.parse(argsEvt.delta)).toEqual({ foo: "bar" });
    });

    it("no duplicate START after tool-input-start followed by tool-call", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-3", "myTool"),
        toolCallDelta("tc-3", "{}"),
        toolCall("tc-3", "myTool"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const startEvents = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-3",
      );
      expect(startEvents).toHaveLength(1);
    });

    it("multiple concurrent tool calls have events correctly paired by toolCallId", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-a", "toolA"),
        toolCallStreamingStart("tc-b", "toolB"),
        toolCallDelta("tc-a", '{"a":1}'),
        toolCallDelta("tc-b", '{"b":2}'),
        toolCall("tc-a", "toolA"),
        toolCall("tc-b", "toolB"),
        toolResult("tc-a", "toolA", "resultA"),
        toolResult("tc-b", "toolB", "resultB"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      // Verify each tool call has its own START
      const startsA = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-a",
      );
      const startsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-b",
      );
      expect(startsA).toHaveLength(1);
      expect(startsB).toHaveLength(1);

      // Verify args are correctly paired
      const argsA = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_ARGS &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-a",
      ) as (BaseEvent & { delta: string })[];
      const argsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_ARGS &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-b",
      ) as (BaseEvent & { delta: string })[];
      expect(argsA[0].delta).toBe('{"a":1}');
      expect(argsB[0].delta).toBe('{"b":2}');

      // Verify results are correctly paired
      const resultsA = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_RESULT &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-a",
      ) as (BaseEvent & { content: string })[];
      const resultsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_RESULT &&
          (e as BaseEvent & { toolCallId: string }).toolCallId === "tc-b",
      ) as (BaseEvent & { content: string })[];
      expect(JSON.parse(resultsA[0].content)).toBe("resultA");
      expect(JSON.parse(resultsB[0].content)).toBe("resultB");
    });
  });

  // ---------------------------------------------------------------------------
  // Reasoning Events
  // ---------------------------------------------------------------------------

  describe("Reasoning Events", () => {
    it("full reasoning lifecycle emits correct REASONING_START/MESSAGE_START/CONTENT/MESSAGE_END/END events", async () => {
      const agent = createAgent("aisdk", [
        reasoningStart("r-1"),
        reasoningDelta("thinking..."),
        reasoningEnd(),
        textDelta("Answer"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      const reasoningEvents = events.filter(
        (e) =>
          e.type === EventType.REASONING_START ||
          e.type === EventType.REASONING_MESSAGE_START ||
          e.type === EventType.REASONING_MESSAGE_CONTENT ||
          e.type === EventType.REASONING_MESSAGE_END ||
          e.type === EventType.REASONING_END,
      );

      expectEventSequence(reasoningEvents, [
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END,
      ]);

      // Verify messageId consistency
      const rStart = reasoningEvents[0] as BaseEvent & { messageId: string };
      const rMsgStart = reasoningEvents[1] as BaseEvent & {
        messageId: string;
        role: string;
      };
      const rContent = reasoningEvents[2] as BaseEvent & {
        messageId: string;
        delta: string;
      };
      const rMsgEnd = reasoningEvents[3] as BaseEvent & { messageId: string };
      const rEnd = reasoningEvents[4] as BaseEvent & { messageId: string };

      expect(rStart.messageId).toBe("r-1");
      expect(rMsgStart.messageId).toBe("r-1");
      expect(rMsgStart.role).toBe("reasoning");
      expect(rContent.messageId).toBe("r-1");
      expect(rContent.delta).toBe("thinking...");
      expect(rMsgEnd.messageId).toBe("r-1");
      expect(rEnd.messageId).toBe("r-1");
    });

    it("empty reasoning deltas are skipped", async () => {
      const agent = createAgent("aisdk", [
        reasoningStart(),
        reasoningDelta(""),
        reasoningDelta("actual content"),
        reasoningDelta(""),
        reasoningEnd(),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const contentEvents = events.filter(
        (e) => e.type === EventType.REASONING_MESSAGE_CONTENT,
      ) as (BaseEvent & { delta: string })[];
      expect(contentEvents).toHaveLength(1);
      expect(contentEvents[0].delta).toBe("actual content");
    });

    it("auto-close reasoning before text-delta", async () => {
      // No explicit reasoning-end — the converter should auto-close
      const agent = createAgent("aisdk", [
        reasoningStart("r-auto"),
        reasoningDelta("thinking"),
        textDelta("Answer"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      // Reasoning should be closed before the text event
      const types = events.map((e) => e.type);
      const msgEndIdx = types.indexOf(EventType.REASONING_MESSAGE_END);
      const reasoningEndIdx = types.indexOf(EventType.REASONING_END);
      const textIdx = types.indexOf(EventType.TEXT_MESSAGE_CHUNK);

      expect(msgEndIdx).toBeGreaterThan(-1);
      expect(reasoningEndIdx).toBeGreaterThan(-1);
      expect(textIdx).toBeGreaterThan(reasoningEndIdx);
    });

    it("auto-close reasoning before tool-input-start", async () => {
      const agent = createAgent("aisdk", [
        reasoningStart(),
        reasoningDelta("thinking about tools"),
        toolCallStreamingStart("tc-r", "someTool"),
        toolCallDelta("tc-r", "{}"),
        toolCall("tc-r", "someTool"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      const types = events.map((e) => e.type);
      const reasoningEndIdx = types.indexOf(EventType.REASONING_END);
      const toolStartIdx = types.indexOf(EventType.TOOL_CALL_START);

      expect(reasoningEndIdx).toBeGreaterThan(-1);
      expect(toolStartIdx).toBeGreaterThan(reasoningEndIdx);
    });

    it("auto-close reasoning before finish", async () => {
      const agent = createAgent("aisdk", [
        reasoningStart(),
        reasoningDelta("deep thought"),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      // Should contain reasoning close events
      const types = events.map((e) => e.type);
      expect(types).toContain(EventType.REASONING_MESSAGE_END);
      expect(types).toContain(EventType.REASONING_END);

      // They should appear before RUN_FINISHED
      const reasoningEndIdx = types.indexOf(EventType.REASONING_END);
      const runFinishedIdx = types.indexOf(EventType.RUN_FINISHED);
      expect(reasoningEndIdx).toBeLessThan(runFinishedIdx);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe("Edge Cases", () => {
    it("unknown event types are silently ignored", async () => {
      const agent = createAgent("aisdk", [
        { type: "some-unknown-event", data: "hello" },
        textDelta("text after unknown"),
        { type: "another-mystery-event" },
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      // Should still have the text chunk
      const textChunks = events.filter(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      );
      expect(textChunks).toHaveLength(1);

      // No events for unknown types — only RUN_STARTED, TEXT_MESSAGE_CHUNK, RUN_FINISHED
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.RUN_FINISHED,
      ]);
    });

    it("large text deltas (100k chars) are passed through", async () => {
      const largeText = "x".repeat(100_000);
      const agent = createAgent("aisdk", [textDelta(largeText), finish()]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events);

      const chunk = events.find(
        (e) => e.type === EventType.TEXT_MESSAGE_CHUNK,
      ) as BaseEvent & { delta: string };
      expect(chunk.delta).toBe(largeText);
      expect(chunk.delta.length).toBe(100_000);
    });
  });
});
