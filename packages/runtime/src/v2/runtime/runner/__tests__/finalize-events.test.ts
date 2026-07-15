import { describe, expect, it } from "vitest";
import type {
  BaseEvent,
  ToolCallResultEvent,
  RunErrorEvent,
} from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
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

  // #5812: once a run has emitted a terminal event, the AG-UI verifier rejects
  // any sub-event streamed after it ("the run has already errored/finished …").
  // Because finalization events are streamed after everything the agent already
  // emitted, finalize must append NOTHING when a terminal already exists — even
  // for messages / tool calls that are still open (the terminal closes them on
  // the client). Regression: it previously appended a trailing TEXT_MESSAGE_END.
  it.each([EventType.RUN_FINISHED, EventType.RUN_ERROR])(
    "appends nothing after an existing %s terminal, even with open sub-events",
    (terminal) => {
      const events: BaseEvent[] = [
        createTextStart("msg-1"),
        createToolStart("tool-1"),
        { type: terminal, message: "boom" } as BaseEvent,
      ];

      const appended = finalizeRunEvents(events, { stopRequested: true });

      expect(appended).toEqual([]);
      // The terminal stays the final event — nothing was pushed after it.
      expect(events.at(-1)?.type).toBe(terminal);
    },
  );

  it("does not append TEXT_MESSAGE_END after a RUN_ERROR emitted on mid-stream stop (#5812)", () => {
    // Mirrors the issue: an HttpAgent proxy is aborted mid-stream, so a live
    // RUN_ERROR arrives while a text message is still open.
    const messageId = "225f30a2-c662-4d0d-a05e-789cb51e17cc";
    const events: BaseEvent[] = [
      createTextStart(messageId),
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: " frames",
      } as BaseEvent,
      {
        type: EventType.RUN_ERROR,
        message: "This operation was aborted",
        code: "abort",
      } as BaseEvent,
    ];

    const appended = finalizeRunEvents(events, { stopRequested: true });

    expect(appended).toEqual([]);
    const runErrorIdx = events.findIndex(
      (event) => event.type === EventType.RUN_ERROR,
    );
    // No events at all follow the terminal RUN_ERROR.
    expect(events.slice(runErrorIdx + 1)).toEqual([]);
  });
});
