import { describe, expect, it } from "vitest";
import {
  BaseEvent,
  EventType,
  ToolCallResultEvent,
  RunErrorEvent,
} from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkit/shared";

const createTextStart = (messageId: string): BaseEvent =>
  ({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
  }) as BaseEvent;

const createToolStart = (toolCallId: string): BaseEvent =>
  ({
    type: EventType.TOOL_CALL_START,
    toolCallId,
  }) as BaseEvent;

describe("finalizeRunEvents", () => {
  it("closes streams with a RUN_FINISHED event when a stop was requested", () => {
    const events: BaseEvent[] = [
      createTextStart("msg-1"),
      createToolStart("tool-1"),
    ];

    const appended = finalizeRunEvents(events, { stopRequested: true });

    expect(appended.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);

    const resultEvent = appended.find(
      (event): event is ToolCallResultEvent =>
        event.type === EventType.TOOL_CALL_RESULT,
    );
    expect(JSON.parse(resultEvent?.content ?? "")).toEqual(
      expect.objectContaining({
        status: "stopped",
        reason: "stop_requested",
      }),
    );

    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("emits a RUN_ERROR with meaningful payload when the stream ends abruptly", () => {
    const events: BaseEvent[] = [
      createTextStart("msg-1"),
      createToolStart("tool-1"),
    ];

    const appended = finalizeRunEvents(events);

    expect(appended.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_ERROR,
    ]);

    const resultEvent = appended.find(
      (event): event is ToolCallResultEvent =>
        event.type === EventType.TOOL_CALL_RESULT,
    );
    expect(JSON.parse(resultEvent?.content ?? "")).toEqual(
      expect.objectContaining({
        status: "error",
        reason: "missing_terminal_event",
      }),
    );

    const errorEvent = appended.find(
      (event): event is RunErrorEvent => event.type === EventType.RUN_ERROR,
    );
    expect(errorEvent?.code).toBe("INCOMPLETE_STREAM");
    expect(errorEvent?.message).toContain("terminal event");
  });

  it("appends nothing once a terminal event already exists", () => {
    const events: BaseEvent[] = [
      createTextStart("msg-1"),
      createToolStart("tool-1"),
      { type: EventType.RUN_FINISHED } as BaseEvent,
    ];

    const appended = finalizeRunEvents(events);

    // The terminal event was already emitted, so any cleanup would land after
    // it and break the AG-UI ordering invariant. Nothing may be appended.
    expect(appended).toEqual([]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("does not append TEXT_MESSAGE_END after a RUN_ERROR when stopped mid-message", () => {
    // Repro for the stop-button crash: an agent errors on abort with a text
    // message still open. Emitting a synthetic TEXT_MESSAGE_END afterwards made
    // the AG-UI client throw "the run has already errored".
    const events: BaseEvent[] = [
      createTextStart("msg-1"),
      { type: EventType.RUN_ERROR, message: "aborted" } as BaseEvent,
    ];

    const appended = finalizeRunEvents(events, { stopRequested: true });

    expect(appended).toEqual([]);
    expect(
      events.some((event) => event.type === EventType.TEXT_MESSAGE_END),
    ).toBe(false);
    expect(events.at(-1)?.type).toBe(EventType.RUN_ERROR);
  });
});
