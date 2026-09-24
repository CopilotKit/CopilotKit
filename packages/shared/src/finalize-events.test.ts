import type {
  BaseEvent,
  RunErrorEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { createRunEventFinalizer, finalizeRunEvents } from "./finalize-events";

const event = (value: Record<string, unknown>): BaseEvent => value as BaseEvent;

describe("createRunEventFinalizer", () => {
  it("closes what is still open and adds a terminal event", () => {
    const source = [
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-1" }),
      event({ type: EventType.TOOL_CALL_START, toolCallId: "tool-1" }),
      event({ type: EventType.TOOL_CALL_END, toolCallId: "tool-1" }),
    ];

    for (const options of [{ stopRequested: true }, {}]) {
      const finalizer = createRunEventFinalizer();
      for (const value of source) finalizer.observe(value);
      const appended = finalizer.finalize(options);

      expect(appended.map(({ type }) => type)).toEqual([
        EventType.TEXT_MESSAGE_END,
        EventType.TOOL_CALL_RESULT,
        options.stopRequested ? EventType.RUN_FINISHED : EventType.RUN_ERROR,
      ]);
      const result = appended[1] as ToolCallResultEvent;
      expect(JSON.parse(result.content)).toMatchObject({
        status: options.stopRequested ? "stopped" : "error",
        reason: options.stopRequested
          ? "stop_requested"
          : "missing_terminal_event",
      });
      expect(finalizer.finalize(options)).toEqual([]);
    }
  });

  it.each([EventType.RUN_FINISHED, EventType.RUN_ERROR])(
    "appends nothing once %s was observed",
    (terminal) => {
      const finalizer = createRunEventFinalizer();
      finalizer.observe(
        event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-1" }),
      );
      finalizer.observe(
        event({ type: terminal, message: "finished upstream" }),
      );
      finalizer.observe(
        event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-2" }),
      );

      expect(finalizer.finalize()).toEqual([]);
    },
  );

  it("closes open reasoning, message before span, because AG-UI 1.0 requires it", () => {
    const finalizer = createRunEventFinalizer();
    for (const value of [
      event({ type: EventType.REASONING_START, messageId: "span-1" }),
      event({ type: EventType.REASONING_MESSAGE_START, messageId: "r-1" }),
      event({ type: EventType.REASONING_START, messageId: "span-2" }),
      event({ type: EventType.REASONING_END, messageId: "span-2" }),
    ]) {
      finalizer.observe(value);
    }

    expect(finalizer.finalize({ stopRequested: true }).slice(0, 2)).toEqual([
      { type: EventType.REASONING_MESSAGE_END, messageId: "r-1" },
      { type: EventType.REASONING_END, messageId: "span-1" },
    ]);
  });

  it("stamps the run identity on a stop and marks it cancelled for a 1.0 client", () => {
    const started = event({
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    });
    const stopFor = (protocolVersion?: string) => {
      const finalizer = createRunEventFinalizer();
      finalizer.observe(started);
      return finalizer.finalize({ stopRequested: true, protocolVersion });
    };

    expect(stopFor("1.0")).toEqual([
      {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
        outcome: { type: "cancelled" },
      },
    ]);
    // A client without a declared version predates 1.0 and cannot parse it.
    expect(stopFor(undefined)).toEqual([
      { type: EventType.RUN_FINISHED, threadId: "thread-1", runId: "run-1" },
    ]);
  });

  it("forgets a lifecycle as soon as it closes", () => {
    const finalizer = createRunEventFinalizer();
    for (let index = 0; index < 1000; index += 1) {
      const messageId = `message-${index}`;
      const toolCallId = `tool-${index}`;
      for (const value of [
        event({ type: EventType.TEXT_MESSAGE_START, messageId }),
        event({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: "x" }),
        event({ type: EventType.TEXT_MESSAGE_END, messageId }),
        event({ type: EventType.TOOL_CALL_START, toolCallId }),
        event({ type: EventType.TOOL_CALL_RESULT, toolCallId, content: "x" }),
        event({ type: EventType.TOOL_CALL_END, toolCallId }),
      ]) {
        finalizer.observe(value);
      }
    }
    finalizer.observe(
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "open" }),
    );

    expect(finalizer.finalize()).toEqual([
      { type: EventType.TEXT_MESSAGE_END, messageId: "open" },
      expect.objectContaining({ type: EventType.RUN_ERROR }),
    ]);
  });

  it.each([
    [EventType.TOOL_CALL_END, EventType.TOOL_CALL_RESULT],
    [EventType.TOOL_CALL_RESULT, EventType.TOOL_CALL_END],
  ])("preserves %s across a repeated start before %s", (first, last) => {
    const finalizer = createRunEventFinalizer();
    for (const type of [
      EventType.TOOL_CALL_START,
      first,
      EventType.TOOL_CALL_START,
      last,
    ]) {
      finalizer.observe(event({ type, toolCallId: "tool-1" }));
    }

    expect(finalizer.finalize().map(({ type }) => type)).toEqual([
      EventType.RUN_ERROR,
    ]);
  });

  it("ignores start events without an id so finalize never emits an empty id", () => {
    const finalizer = createRunEventFinalizer();
    finalizer.observe(
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "" }),
    );
    finalizer.observe(
      event({ type: EventType.TOOL_CALL_START, toolCallId: "" }),
    );
    finalizer.observe(event({ type: EventType.TOOL_CALL_START }));

    expect(finalizer.finalize().map((e) => e.type)).toEqual([
      EventType.RUN_ERROR,
    ]);
  });
});

describe("finalizeRunEvents", () => {
  it("appends the closers in place and keeps the interruption message", () => {
    const events = [
      event({ type: EventType.TOOL_CALL_START, toolCallId: "tool-1" }),
      event({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "tool-1",
        messageId: "result-1",
        role: "tool",
        content: "done",
      }),
    ];
    const appended = finalizeRunEvents(events, {
      interruptionMessage: "Gateway connection failed",
    });

    expect(appended.map(({ type }) => type)).toEqual([
      EventType.TOOL_CALL_END,
      EventType.RUN_ERROR,
    ]);
    expect((appended[1] as RunErrorEvent).message).toBe(
      "Gateway connection failed",
    );
    expect(events.slice(-2)).toEqual(appended);
  });
});
