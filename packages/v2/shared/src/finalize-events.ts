import {
  BaseEvent,
  EventType,
  RunErrorEvent,
} from "@ag-ui/client";
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

  const hasRunFinished = events.some((event) => event.type === EventType.RUN_FINISHED);
  const hasRunError = events.some((event) => event.type === EventType.RUN_ERROR);
  const hasTerminalEvent = hasRunFinished || hasRunError;
  const terminalEventMissing = !hasTerminalEvent;

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

    if (terminalEventMissing && !info.hasResult) {
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

  if (terminalEventMissing) {
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
  }

  return appended;
}
