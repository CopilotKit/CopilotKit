import { describe, expect, it } from "vitest";
import {
  BaseEvent,
  EventType,
  ToolCallResultEvent,
  RunErrorEvent,
} from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkitnext/shared";

const createTextStart = (messageId: string): BaseEvent => ({
  type: EventType.TEXT_MESSAGE_START,
  messageId,
} as BaseEvent);

const createToolStart = (toolCallId: string): BaseEvent => ({
  type: EventType.TOOL_CALL_START,
  toolCallId,
} as BaseEvent);

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
      (event): event is ToolCallResultEvent => event.type === EventType.TOOL_CALL_RESULT,
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
      (event): event is ToolCallResultEvent => event.type === EventType.TOOL_CALL_RESULT,
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

  it("only appends structural fixes when a terminal event already exists", () => {
    const events: BaseEvent[] = [
      createTextStart("msg-1"),
      createToolStart("tool-1"),
      { type: EventType.RUN_FINISHED } as BaseEvent,
    ];

    const appended = finalizeRunEvents(events);

    expect(appended.map((event) => event.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
    ]);

    expect(appended.some((event) => event.type === EventType.TOOL_CALL_RESULT)).toBe(false);
    expect(appended.some((event) => event.type === EventType.RUN_ERROR)).toBe(false);
    expect(appended.some((event) => event.type === EventType.RUN_FINISHED)).toBe(false);
  });
});
