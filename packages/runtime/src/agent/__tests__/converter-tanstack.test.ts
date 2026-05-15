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
  tanstackToolCallResult,
  tanstackReasoningStart,
  tanstackReasoningMessageStart,
  tanstackReasoningMessageContent,
  tanstackReasoningMessageEnd,
  tanstackReasoningEnd,
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

describe("TanStack AI converter — state tools", () => {
  it("emits STATE_SNAPSHOT before TOOL_CALL_RESULT for AGUISendStateSnapshot", async () => {
    const snapshot = { counter: 5, items: ["x", "y"] };
    const agent = createAgent("tanstack", [
      tanstackToolCallStart("call1", "AGUISendStateSnapshot"),
      tanstackToolCallEnd("call1"),
      tanstackToolCallResult("call1", { success: true, snapshot }),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    expectLifecycleWrapped(events);

    const snapshotIdx = events.findIndex(
      (e) => e.type === EventType.STATE_SNAPSHOT,
    );
    const resultIdx = events.findIndex(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    );

    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThanOrEqual(0);
    expect(snapshotIdx).toBeLessThan(resultIdx);
    expect(eventField<unknown>(events[snapshotIdx], "snapshot")).toEqual(
      snapshot,
    );
  });

  it("emits STATE_DELTA before TOOL_CALL_RESULT for AGUISendStateDelta", async () => {
    const delta = [{ op: "replace", path: "/counter", value: 7 }];
    const agent = createAgent("tanstack", [
      tanstackToolCallStart("call1", "AGUISendStateDelta"),
      tanstackToolCallEnd("call1"),
      tanstackToolCallResult("call1", { success: true, delta }),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    expectLifecycleWrapped(events);

    const deltaIdx = events.findIndex((e) => e.type === EventType.STATE_DELTA);
    const resultIdx = events.findIndex(
      (e) => e.type === EventType.TOOL_CALL_RESULT,
    );

    expect(deltaIdx).toBeGreaterThanOrEqual(0);
    expect(deltaIdx).toBeLessThan(resultIdx);
    expect(eventField<unknown>(events[deltaIdx], "delta")).toEqual(delta);
  });

  it("emits STATE_SNAPSHOT when payload arrives in raw.result instead of raw.content", async () => {
    // Regression: serialization fell back to raw.result (`?? raw.result ?? null`)
    // but state-tool detection only inspected raw.content, so STATE_* events
    // were silently dropped if upstream used `result` for the state-tool body.
    // See the "TOOL_CALL_RESULT with object content serializes to JSON" test
    // above which already exercises the `result` field on a non-state tool.
    const snapshot = { counter: 99 };
    const agent = createAgent("tanstack", [
      tanstackToolCallStart("call1", "AGUISendStateSnapshot"),
      tanstackToolCallEnd("call1"),
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "call1",
        result: { success: true, snapshot },
      },
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    expectLifecycleWrapped(events);

    const snapshotIdx = events.findIndex(
      (e) => e.type === EventType.STATE_SNAPSHOT,
    );
    expect(snapshotIdx).toBeGreaterThanOrEqual(0);
    expect(eventField<unknown>(events[snapshotIdx], "snapshot")).toEqual(
      snapshot,
    );
  });

  it("does NOT emit STATE_* for non-state tool results", async () => {
    const agent = createAgent("tanstack", [
      tanstackToolCallStart("call1", "getWeather"),
      tanstackToolCallEnd("call1"),
      tanstackToolCallResult("call1", {
        snapshot: { spoofed: true },
        delta: [{ op: "x" }],
      }),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    expectLifecycleWrapped(events);

    expect(
      events.find(
        (e) =>
          e.type === EventType.STATE_SNAPSHOT ||
          e.type === EventType.STATE_DELTA,
      ),
    ).toBeUndefined();
    expect(
      events.find((e) => e.type === EventType.TOOL_CALL_RESULT),
    ).toBeDefined();
  });
});

describe("TanStack AI converter — reasoning", () => {
  it("emits the full REASONING lifecycle for reasoning chunks", async () => {
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "thinking"),
      tanstackReasoningMessageEnd("r1"),
      tanstackReasoningEnd("r1"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));

    expectLifecycleWrapped(events);

    // Strip the lifecycle wrap and inspect the inner sequence.
    const inner = events.slice(1, -1).map((e) => e.type);
    expect(inner).toEqual([
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
    ]);
  });

  it("auto-closes an open reasoning lifecycle when text starts", async () => {
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "thinking"),
      // No REASONING_MESSAGE_END / REASONING_END before text
      tanstackTextChunk("Hi"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    const reasonEndIdx = types.indexOf(EventType.REASONING_END);
    const reasonMsgEndIdx = types.indexOf(EventType.REASONING_MESSAGE_END);
    const textIdx = types.indexOf(EventType.TEXT_MESSAGE_CHUNK);

    expect(reasonMsgEndIdx).toBeGreaterThan(-1);
    expect(reasonEndIdx).toBeGreaterThan(-1);
    expect(reasonEndIdx).toBeLessThan(textIdx);
  });

  it("auto-closes an open reasoning lifecycle when a tool call starts", async () => {
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "..."),
      tanstackToolCallStart("t1", "x"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    expect(types).toContain(EventType.REASONING_MESSAGE_END);
    expect(types).toContain(EventType.REASONING_END);
    expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(
      types.indexOf(EventType.TOOL_CALL_START),
    );
  });

  it("auto-closes when the stream ends without explicit reasoning end", async () => {
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "x"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    expect(types).toContain(EventType.REASONING_MESSAGE_END);
    expect(types).toContain(EventType.REASONING_END);
  });

  it("emits REASONING_MESSAGE_END before REASONING_END when upstream sends END with message still open", async () => {
    // Regression: if the converter received REASONING_END while a message
    // was still open, it cleared run-open and emitted END only — leaving
    // message-open true. The next non-reasoning chunk then triggered
    // closeReasoningIfOpen, which emitted MSG_END AFTER END (wrong order).
    // Fix: REASONING_END handler closes any open message first.
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "thinking"),
      // Upstream skips MSG_END and goes straight to END
      tanstackReasoningEnd("r1"),
      tanstackTextChunk("Hi"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    const msgEndIdx = types.indexOf(EventType.REASONING_MESSAGE_END);
    const endIdx = types.indexOf(EventType.REASONING_END);

    expect(msgEndIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(msgEndIdx).toBeLessThan(endIdx);
    // No duplicate MSG_END or END from auto-close on the text chunk
    expect(
      types.filter((t) => t === EventType.REASONING_MESSAGE_END),
    ).toHaveLength(1);
    expect(types.filter((t) => t === EventType.REASONING_END)).toHaveLength(1);
  });

  it("auto-closes prior reasoning run when a new REASONING_START arrives without END", async () => {
    // Regression: REASONING_START used to overwrite reasoningMessageId
    // unconditionally, orphaning the prior run's MSG_END / END.
    // Fix: REASONING_START handler calls closeReasoningIfOpen() first.
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "first"),
      // Second START with no intervening END
      tanstackReasoningStart("r2"),
      tanstackReasoningMessageStart("r2"),
      tanstackReasoningMessageContent("r2", "second"),
      tanstackReasoningMessageEnd("r2"),
      tanstackReasoningEnd("r2"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    // Two complete START → MSG_START → ... → MSG_END → END sequences
    expect(types.filter((t) => t === EventType.REASONING_START)).toHaveLength(
      2,
    );
    expect(types.filter((t) => t === EventType.REASONING_END)).toHaveLength(2);
    expect(
      types.filter((t) => t === EventType.REASONING_MESSAGE_END),
    ).toHaveLength(2);

    // First START's prior message gets closed BEFORE the second START
    const firstEndIdx = types.indexOf(EventType.REASONING_END);
    const secondStartIdx = types.indexOf(
      EventType.REASONING_START,
      firstEndIdx + 1,
    );
    expect(firstEndIdx).toBeLessThan(secondStartIdx);
  });

  it("does NOT duplicate REASONING_MESSAGE_END when upstream emits it explicitly before text", async () => {
    // Regression: a single isInReasoning flag conflated message-open with
    // run-open, so closeReasoningIfOpen on TEXT_MESSAGE_CONTENT emitted a
    // second REASONING_MESSAGE_END after upstream's own. Track message-open
    // and run-open separately so closeReasoningIfOpen owes only what's still
    // open.
    const agent = createAgent("tanstack", [
      tanstackReasoningStart("r1"),
      tanstackReasoningMessageStart("r1"),
      tanstackReasoningMessageContent("r1", "thinking"),
      tanstackReasoningMessageEnd("r1"),
      // No explicit REASONING_END before text — closeReasoningIfOpen should
      // emit REASONING_END but NOT a second REASONING_MESSAGE_END.
      tanstackTextChunk("Hi"),
    ]);
    const events = await collectEvents(agent.run(createDefaultInput()));
    const types = events.map((e) => e.type);

    const msgEndCount = types.filter(
      (t) => t === EventType.REASONING_MESSAGE_END,
    ).length;
    const endCount = types.filter((t) => t === EventType.REASONING_END).length;

    expect(msgEndCount).toBe(1);
    expect(endCount).toBe(1);
    expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(
      types.indexOf(EventType.TEXT_MESSAGE_CHUNK),
    );
  });
});
