import type { BaseEvent, RunErrorEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { randomUUID } from "./utils";

interface FinalizeRunOptions {
  stopRequested?: boolean;
  interruptionMessage?: string;
}

const defaultStopMessage = "Run stopped by user";
const defaultAbruptEndMessage = "Run ended without emitting a terminal event";

export function finalizeRunEvents(
  events: BaseEvent[],
  options: FinalizeRunOptions = {},
): BaseEvent[] {
  const { stopRequested = false, interruptionMessage } = options;

  const resolvedStopMessage = interruptionMessage ?? defaultStopMessage;
  const resolvedAbruptMessage =
    interruptionMessage && interruptionMessage !== defaultStopMessage
      ? interruptionMessage
      : defaultAbruptEndMessage;

  const appended: BaseEvent[] = [];

  const openMessageIds = new Set<string>();
  const openToolCalls = new Map<
    string,
    {
      hasEnd: boolean;
      hasResult: boolean;
    }
  >();

  for (const event of events) {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        const messageId = (event as { messageId?: string }).messageId;
        if (typeof messageId === "string") {
          openMessageIds.add(messageId);
        }
        break;
      }
      case EventType.TEXT_MESSAGE_END: {
        const messageId = (event as { messageId?: string }).messageId;
        if (typeof messageId === "string") {
          openMessageIds.delete(messageId);
        }
        break;
      }
      case EventType.TOOL_CALL_START: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (typeof toolCallId === "string") {
          openToolCalls.set(toolCallId, {
            hasEnd: false,
            hasResult: false,
          });
        }
        break;
      }
      case EventType.TOOL_CALL_END: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        const info = toolCallId ? openToolCalls.get(toolCallId) : undefined;
        if (info) {
          info.hasEnd = true;
        }
        break;
      }
      case EventType.TOOL_CALL_RESULT: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        const info = toolCallId ? openToolCalls.get(toolCallId) : undefined;
        if (info) {
          info.hasResult = true;
        }
        break;
      }
      default:
        break;
    }
  }

  const hasTerminalEvent = events.some(
    (event) =>
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR,
  );

  // Once a run has emitted a terminal event (RUN_FINISHED or RUN_ERROR), the
  // AG-UI spec forbids any further events for that run — the verifier rejects a
  // trailing TEXT_MESSAGE_END / TOOL_CALL_END with "the run has already
  // errored/finished with '…'. No further events can be sent." (issue #5812).
  // These finalization events are streamed *after* everything the agent already
  // emitted, so appending closers here would place them after that terminal.
  // When a terminal already exists we therefore append nothing: any message or
  // tool call still open when the terminal arrived is implicitly closed by the
  // terminal on the client. We only synthesize closers + a terminal for a
  // stream that ended abruptly without a terminal of its own (below).
  if (hasTerminalEvent) {
    return appended;
  }

  for (const messageId of openMessageIds) {
    const endEvent = {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    } as BaseEvent;
    events.push(endEvent);
    appended.push(endEvent);
  }

  for (const [toolCallId, info] of openToolCalls) {
    if (!info.hasEnd) {
      const endEvent = {
        type: EventType.TOOL_CALL_END,
        toolCallId,
      } as BaseEvent;
      events.push(endEvent);
      appended.push(endEvent);
    }

    if (!info.hasResult) {
      const resultEvent = {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId,
        messageId: `${toolCallId ?? randomUUID()}-result`,
        role: "tool",
        content: JSON.stringify(
          stopRequested
            ? {
                status: "stopped",
                reason: "stop_requested",
                message: resolvedStopMessage,
              }
            : {
                status: "error",
                reason: "missing_terminal_event",
                message: resolvedAbruptMessage,
              },
        ),
      } as BaseEvent;
      events.push(resultEvent);
      appended.push(resultEvent);
    }
  }

  if (stopRequested) {
    const finishedEvent = {
      type: EventType.RUN_FINISHED,
    } as BaseEvent;
    events.push(finishedEvent);
    appended.push(finishedEvent);
  } else {
    const errorEvent: RunErrorEvent = {
      type: EventType.RUN_ERROR,
      message: resolvedAbruptMessage,
      code: "INCOMPLETE_STREAM",
    };
    events.push(errorEvent);
    appended.push(errorEvent);
  }

  return appended;
}
