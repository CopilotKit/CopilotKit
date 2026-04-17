import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  collectEventsIncludingErrors,
  expectLifecycleWrapped,
  expectEventSequence,
  eventField,
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

      expect(eventField<string>(textChunks[0], "role")).toBe("assistant");
      expect(eventField<string>(textChunks[0], "delta")).toBe("Hello");
      expect(eventField<string>(textChunks[0], "messageId")).toBeDefined();
      expect(typeof eventField<string>(textChunks[0], "messageId")).toBe(
        "string",
      );
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
      )!;
      expect(eventField<string>(chunk, "messageId")).toBe("custom-msg-id");
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
      )!;
      expect(eventField<string>(chunk, "messageId")).not.toBe("0");
      expect(eventField<string>(chunk, "messageId")).toBeDefined();
      expect(eventField<string>(chunk, "messageId").length).toBeGreaterThan(0);
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
      );
      expect(textChunks).toHaveLength(2);
      expect(eventField<string>(textChunks[0], "messageId")).toBe(
        eventField<string>(textChunks[1], "messageId"),
      );
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
      expect(eventField<string>(toolEvents[0], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(toolEvents[0], "toolCallName")).toBe("myTool");

      // Verify TOOL_CALL_ARGS deltas
      const argsEvts = toolEvents.filter(
        (e) => e.type === EventType.TOOL_CALL_ARGS,
      );
      expect(eventField<string>(argsEvts[0], "delta")).toBe('{"key":');
      expect(eventField<string>(argsEvts[1], "delta")).toBe('"value"}');

      // Verify TOOL_CALL_END
      expect(eventField<string>(toolEvents[2 + 1], "toolCallId")).toBe("tc-1");

      // Verify TOOL_CALL_RESULT
      expect(eventField<string>(toolEvents[4], "toolCallId")).toBe("tc-1");
      expect(JSON.parse(eventField<string>(toolEvents[4], "content"))).toEqual({
        result: "ok",
      });
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

      expect(eventField<string>(toolEvents[0], "toolCallId")).toBe("tc-2");
      expect(eventField<string>(toolEvents[0], "toolCallName")).toBe(
        "directTool",
      );

      expect(JSON.parse(eventField<string>(toolEvents[1], "delta"))).toEqual({
        foo: "bar",
      });
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
          eventField<string>(e, "toolCallId") === "tc-3",
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
          eventField<string>(e, "toolCallId") === "tc-a",
      );
      const startsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_START &&
          eventField<string>(e, "toolCallId") === "tc-b",
      );
      expect(startsA).toHaveLength(1);
      expect(startsB).toHaveLength(1);

      // Verify args are correctly paired
      const argsA = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_ARGS &&
          eventField<string>(e, "toolCallId") === "tc-a",
      );
      const argsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_ARGS &&
          eventField<string>(e, "toolCallId") === "tc-b",
      );
      expect(eventField<string>(argsA[0], "delta")).toBe('{"a":1}');
      expect(eventField<string>(argsB[0], "delta")).toBe('{"b":2}');

      // Verify results are correctly paired
      const resultsA = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_RESULT &&
          eventField<string>(e, "toolCallId") === "tc-a",
      );
      const resultsB = events.filter(
        (e) =>
          e.type === EventType.TOOL_CALL_RESULT &&
          eventField<string>(e, "toolCallId") === "tc-b",
      );
      expect(JSON.parse(eventField<string>(resultsA[0], "content"))).toBe(
        "resultA",
      );
      expect(JSON.parse(eventField<string>(resultsB[0], "content"))).toBe(
        "resultB",
      );
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
      expect(eventField<string>(reasoningEvents[0], "messageId")).toBe("r-1");
      expect(eventField<string>(reasoningEvents[1], "messageId")).toBe("r-1");
      expect(eventField<string>(reasoningEvents[1], "role")).toBe("reasoning");
      expect(eventField<string>(reasoningEvents[2], "messageId")).toBe("r-1");
      expect(eventField<string>(reasoningEvents[2], "delta")).toBe(
        "thinking...",
      );
      expect(eventField<string>(reasoningEvents[3], "messageId")).toBe("r-1");
      expect(eventField<string>(reasoningEvents[4], "messageId")).toBe("r-1");
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
      );
      expect(contentEvents).toHaveLength(1);
      expect(eventField<string>(contentEvents[0], "delta")).toBe(
        "actual content",
      );
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
  // State Management Tool Results
  // ---------------------------------------------------------------------------

  describe("State Management Tool Results", () => {
    it("AGUISendStateSnapshot tool result emits STATE_SNAPSHOT event", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-state", "AGUISendStateSnapshot"),
        toolCallDelta("tc-state", '{"snapshot":{"count":1}}'),
        toolCall("tc-state", "AGUISendStateSnapshot"),
        toolResult("tc-state", "AGUISendStateSnapshot", {
          snapshot: { count: 1 },
        }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const stateSnapshots = events.filter(
        (e) => e.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshots).toHaveLength(1);
      expect(eventField(stateSnapshots[0], "snapshot")).toEqual({ count: 1 });
    });

    it("AGUISendStateDelta tool result emits STATE_DELTA event", async () => {
      const delta = [{ op: "replace", path: "/count", value: 2 }];
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-delta", "AGUISendStateDelta"),
        toolCallDelta("tc-delta", JSON.stringify({ delta })),
        toolCall("tc-delta", "AGUISendStateDelta"),
        toolResult("tc-delta", "AGUISendStateDelta", { delta }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const stateDeltas = events.filter(
        (e) => e.type === EventType.STATE_DELTA,
      );
      expect(stateDeltas).toHaveLength(1);
      expect(eventField(stateDeltas[0], "delta")).toEqual(delta);
    });

    it("state tool result also emits TOOL_CALL_RESULT event", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-state2", "AGUISendStateSnapshot"),
        toolCallDelta("tc-state2", "{}"),
        toolCall("tc-state2", "AGUISendStateSnapshot"),
        toolResult("tc-state2", "AGUISendStateSnapshot", {
          snapshot: { x: 1 },
        }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const toolResults = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(toolResults).toHaveLength(1);
      expect(eventField<string>(toolResults[0], "toolCallId")).toBe(
        "tc-state2",
      );
    });

    it("does not emit STATE_SNAPSHOT when snapshot field is undefined", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-no-snap", "AGUISendStateSnapshot"),
        toolCallDelta("tc-no-snap", "{}"),
        toolCall("tc-no-snap", "AGUISendStateSnapshot"),
        toolResult("tc-no-snap", "AGUISendStateSnapshot", {
          success: true,
        }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const stateSnapshots = events.filter(
        (e) => e.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshots).toHaveLength(0);

      // Should still emit the TOOL_CALL_RESULT
      const toolResults = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(toolResults).toHaveLength(1);
    });

    it("does not emit STATE_DELTA when delta field is undefined", async () => {
      const agent = createAgent("aisdk", [
        toolCallStreamingStart("tc-no-delta", "AGUISendStateDelta"),
        toolCallDelta("tc-no-delta", "{}"),
        toolCall("tc-no-delta", "AGUISendStateDelta"),
        toolResult("tc-no-delta", "AGUISendStateDelta", {
          success: true,
        }),
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const stateDeltas = events.filter(
        (e) => e.type === EventType.STATE_DELTA,
      );
      expect(stateDeltas).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Result Property Compatibility
  // ---------------------------------------------------------------------------

  describe("Tool Result Property Compatibility", () => {
    it("reads tool result from 'result' property when 'output' is absent", async () => {
      // Simulate older AI SDK that uses "result" instead of "output"
      const agent = createAgent("aisdk", [
        toolCall("tc-compat", "myTool"),
        {
          type: "tool-result",
          toolCallId: "tc-compat",
          toolName: "myTool",
          result: { data: "from-result-prop" },
        },
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const resultEvents = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(resultEvents).toHaveLength(1);
      expect(
        JSON.parse(eventField<string>(resultEvents[0], "content")),
      ).toEqual({ data: "from-result-prop" });
    });

    it("prefers 'output' over 'result' when both are present", async () => {
      const agent = createAgent("aisdk", [
        toolCall("tc-both", "myTool"),
        {
          type: "tool-result",
          toolCallId: "tc-both",
          toolName: "myTool",
          output: { source: "output" },
          result: { source: "result" },
        },
        finish(),
      ]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      const resultEvents = events.filter(
        (e) => e.type === EventType.TOOL_CALL_RESULT,
      );
      expect(
        JSON.parse(eventField<string>(resultEvents[0], "content")),
      ).toEqual({ source: "output" });
    });
  });

  // ---------------------------------------------------------------------------
  // Error Event Handling
  // ---------------------------------------------------------------------------

  describe("Error Event Handling", () => {
    it("wraps undefined error in a descriptive Error", async () => {
      const agent = createAgent("aisdk", [
        textDelta("before error"),
        { type: "error" }, // no .error property
      ]);
      const input = createDefaultInput();

      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(input),
      );

      expect(errored).toBe(true);
      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(errorEvents).toHaveLength(1);
      // Should contain a useful message, not just "undefined"
      expect(eventField<string>(errorEvents[0], "message")).not.toBe(
        "undefined",
      );
      expect(
        eventField<string>(errorEvents[0], "message").length,
      ).toBeGreaterThan(5);
    });

    it("preserves Error instances from error event", async () => {
      const agent = createAgent("aisdk", [
        { type: "error", error: new Error("rate limit exceeded") },
      ]);
      const input = createDefaultInput();

      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(input),
      );

      expect(errored).toBe(true);
      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(eventField<string>(errorEvents[0], "message")).toBe(
        "rate limit exceeded",
      );
    });

    it("handles string error from error event", async () => {
      const agent = createAgent("aisdk", [
        { type: "error", message: "auth failed" },
      ]);
      const input = createDefaultInput();

      const { events, errored } = await collectEventsIncludingErrors(
        agent.run(input),
      );

      expect(errored).toBe(true);
      const errorEvents = events.filter((e) => e.type === EventType.RUN_ERROR);
      expect(eventField<string>(errorEvents[0], "message")).toBe("auth failed");
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
      )!;
      expect(eventField<string>(chunk, "delta")).toBe(largeText);
      expect(eventField<string>(chunk, "delta").length).toBe(100_000);
    });
  });
});
