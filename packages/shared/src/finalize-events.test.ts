import type {
  BaseEvent,
  RunErrorEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import {
  createRunEventFinalizer,
  finalizeRunEvents,
  RunEventFinalizerOverflowError,
} from "./finalize-events";

const event = (value: Record<string, unknown>): BaseEvent => value as BaseEvent;

describe("createRunEventFinalizer", () => {
  it("preserves stop, broken-stream, and existing-terminal finalization contracts", () => {
    const source = [
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-1" }),
      event({ type: EventType.TOOL_CALL_START, toolCallId: "tool-1" }),
      event({ type: EventType.TOOL_CALL_END, toolCallId: "tool-1" }),
    ];

    for (const options of [{ stopRequested: true }, {}]) {
      const finalizer = createRunEventFinalizer({ maxOpenLifecycles: 2 });
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

    for (const terminal of [EventType.RUN_FINISHED, EventType.RUN_ERROR]) {
      const finalizer = createRunEventFinalizer({ maxOpenLifecycles: 2 });
      finalizer.observe(source[0]);
      finalizer.observe(
        event({ type: terminal, message: "finished upstream" }),
      );
      expect(finalizer.finalize()).toEqual([]);
      expect(finalizer.snapshot()).toEqual({
        terminalEventObserved: true,
        openTextMessageIds: [],
        openToolCalls: [],
      });
    }
  });

  it("prunes completed IDs and reports budget overflow without retaining the rejected event", () => {
    const finalizer = createRunEventFinalizer({ maxOpenLifecycles: 2 });
    finalizer.observe(
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-1" }),
    );
    finalizer.observe(
      event({ type: EventType.TOOL_CALL_START, toolCallId: "tool-1" }),
    );

    expect(() =>
      finalizer.observe(
        event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-2" }),
      ),
    ).toThrowError(RunEventFinalizerOverflowError);
    expect(finalizer.snapshot().openTextMessageIds).toEqual(["message-1"]);

    finalizer.observe(
      event({ type: EventType.TEXT_MESSAGE_END, messageId: "message-1" }),
    );
    finalizer.observe(
      event({ type: EventType.TOOL_CALL_RESULT, toolCallId: "tool-1" }),
    );
    finalizer.observe(
      event({ type: EventType.TOOL_CALL_END, toolCallId: "tool-1" }),
    );
    finalizer.observe(
      event({ type: EventType.TEXT_MESSAGE_START, messageId: "message-2" }),
    );

    expect(finalizer.snapshot()).toEqual({
      terminalEventObserved: false,
      openTextMessageIds: ["message-2"],
      openToolCalls: [],
    });
  });

  it.each([50, 200, 1000])(
    "keeps compact state independent of %i completed lifecycles and large payloads",
    (lifecycleCount) => {
      const finalizer = createRunEventFinalizer({ maxOpenLifecycles: 4 });
      const rawEvents: BaseEvent[] = [
        event({
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            {
              id: "large-message",
              role: "assistant",
              content: "S".repeat(512 * 1024),
            },
          ],
        }),
        event({
          type: EventType.CUSTOM,
          name: "open_ui",
          value: { html: `<html>${"H".repeat(512 * 1024)}</html>` },
        }),
      ];

      for (let index = 0; index < lifecycleCount; index += 1) {
        rawEvents.push(
          event({
            type: EventType.TEXT_MESSAGE_START,
            messageId: `message-${index}`,
          }),
          event({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: `message-${index}`,
            delta: "payload that the finalizer must not retain",
          }),
          event({
            type: EventType.TEXT_MESSAGE_END,
            messageId: `message-${index}`,
          }),
          event({
            type: EventType.TOOL_CALL_START,
            toolCallId: `tool-${index}`,
          }),
          event({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: `tool-${index}`,
            messageId: `result-${index}`,
            role: "tool",
            content: "tool payload that the finalizer must not retain",
          }),
          event({ type: EventType.TOOL_CALL_END, toolCallId: `tool-${index}` }),
        );
      }
      for (const value of rawEvents) finalizer.observe(value);

      const retainedState = JSON.stringify(finalizer.snapshot());
      expect(JSON.stringify(rawEvents).length).toBeGreaterThan(1024 * 1024);
      expect(retainedState).toBe(
        '{"terminalEventObserved":false,"openTextMessageIds":[],"openToolCalls":[]}',
      );
    },
  );

  it("ignores start events without an id so finalize never emits an empty id", () => {
    const finalizer = createRunEventFinalizer({ maxOpenLifecycles: 1 });
    finalizer.observe(event({ type: EventType.TEXT_MESSAGE_START, messageId: "" }));
    finalizer.observe(event({ type: EventType.TOOL_CALL_START, toolCallId: "" }));
    finalizer.observe(event({ type: EventType.TOOL_CALL_START }));

    expect(finalizer.snapshot()).toEqual({
      terminalEventObserved: false,
      openTextMessageIds: [],
      openToolCalls: [],
    });
    expect(finalizer.finalize().map((e) => e.type)).toEqual([EventType.RUN_ERROR]);
  });
});

describe("finalizeRunEvents compatibility", () => {
  it("uses the compact reducer while preserving mutation and interruption messages", () => {
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
