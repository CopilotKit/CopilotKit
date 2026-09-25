import type { BaseEvent, RunErrorEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

export interface FinalizeRunOptions {
  stopRequested?: boolean;
  interruptionMessage?: string;
  /**
   * The `protocolVersion` the client declared on its RunAgentInput. When it is
   * set, a stopped run finishes with the AG-UI 1.0 `cancelled` outcome. A
   * client that declares no version predates 1.0 and cannot parse that
   * outcome, so it gets the plain RUN_FINISHED it always got.
   */
  protocolVersion?: string;
}

export interface RunEventFinalizer {
  /** Observe one streamed event. Only the ids of open lifecycles are kept. */
  observe(event: BaseEvent): void;
  /** Return the events that close an interrupted or abruptly ended stream. */
  finalize(options?: FinalizeRunOptions): BaseEvent[];
}

const defaultStopMessage = "Run stopped by user";
const defaultAbruptEndMessage = "Run ended without emitting a terminal event";

interface OpenToolCall {
  hasEnd: boolean;
  hasResult: boolean;
}

/**
 * Incremental finalizer for a streamed AG-UI run. Feed every event to
 * `observe`; when the stream ends without a terminal event, `finalize` returns
 * the closers for reasoning, text messages and tool calls still open plus a
 * terminal event. AG-UI 1.0 fails a run that ends with reasoning still open,
 * so reasoning is closed too. It also fails a RUN_FINISHED while a subagent
 * is still open, so a stop closes open subagents as well; a RUN_ERROR
 * abandons them, which the protocol allows. Closed lifecycles are forgotten at once and payloads are never kept,
 * so a caller does not have to retain the event array for this purpose.
 */
export function createRunEventFinalizer(): RunEventFinalizer {
  const openMessageIds = new Set<string>();
  const openReasoningMessageIds = new Set<string>();
  const openReasoningSpanIds = new Set<string>();
  const openToolCalls = new Map<string, OpenToolCall>();
  // Insertion order is start order, so closing in reverse closes children first.
  const openSubagentRunIds = new Set<string>();
  let runIdentity: { threadId?: string; runId?: string } = {};
  let terminalEventObserved = false;

  const clearOpen = () => {
    openMessageIds.clear();
    openReasoningMessageIds.clear();
    openReasoningSpanIds.clear();
    openToolCalls.clear();
    openSubagentRunIds.clear();
  };

  const observe = (event: BaseEvent) => {
    if (terminalEventObserved) return;

    switch (event.type) {
      case EventType.RUN_STARTED: {
        const { threadId, runId } = event as {
          threadId?: string;
          runId?: string;
        };
        runIdentity = { threadId, runId };
        break;
      }
      case EventType.REASONING_START:
      case EventType.REASONING_END:
      case EventType.REASONING_MESSAGE_START:
      case EventType.REASONING_MESSAGE_END: {
        const messageId = (event as { messageId?: string }).messageId;
        if (typeof messageId !== "string") break;
        const open =
          event.type === EventType.REASONING_START ||
          event.type === EventType.REASONING_END
            ? openReasoningSpanIds
            : openReasoningMessageIds;
        if (
          event.type === EventType.REASONING_START ||
          event.type === EventType.REASONING_MESSAGE_START
        ) {
          open.add(messageId);
        } else {
          open.delete(messageId);
        }
        break;
      }
      case EventType.TEXT_MESSAGE_START: {
        const messageId = (event as { messageId?: string }).messageId;
        if (messageId) openMessageIds.add(messageId);
        break;
      }
      case EventType.TEXT_MESSAGE_END: {
        const messageId = (event as { messageId?: string }).messageId;
        if (typeof messageId === "string") openMessageIds.delete(messageId);
        break;
      }
      case EventType.TOOL_CALL_START: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (toolCallId && !openToolCalls.has(toolCallId)) {
          openToolCalls.set(toolCallId, { hasEnd: false, hasResult: false });
        }
        break;
      }
      case EventType.TOOL_CALL_END:
      case EventType.TOOL_CALL_RESULT: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (!toolCallId) break;
        const info = openToolCalls.get(toolCallId);
        if (!info) break;

        if (event.type === EventType.TOOL_CALL_END) info.hasEnd = true;
        else info.hasResult = true;
        if (info.hasEnd && info.hasResult) openToolCalls.delete(toolCallId);
        break;
      }
      case EventType.SUBAGENT_STARTED:
      case EventType.SUBAGENT_FINISHED:
      case EventType.SUBAGENT_ERROR: {
        const subagentRunId = (event as { subagentRunId?: string })
          .subagentRunId;
        if (!subagentRunId) break;
        if (event.type === EventType.SUBAGENT_STARTED) {
          openSubagentRunIds.add(subagentRunId);
        } else {
          openSubagentRunIds.delete(subagentRunId);
        }
        break;
      }
      case EventType.RUN_FINISHED:
      case EventType.RUN_ERROR:
        terminalEventObserved = true;
        clearOpen();
        break;
      default:
        break;
    }
  };

  const finalize = (options: FinalizeRunOptions = {}): BaseEvent[] => {
    if (terminalEventObserved) return [];

    const { stopRequested = false, interruptionMessage } = options;
    const resolvedStopMessage = interruptionMessage ?? defaultStopMessage;
    const resolvedAbruptMessage =
      interruptionMessage && interruptionMessage !== defaultStopMessage
        ? interruptionMessage
        : defaultAbruptEndMessage;
    const appended: BaseEvent[] = [];

    // A reasoning message closes before the span that holds it.
    for (const messageId of openReasoningMessageIds) {
      appended.push({
        type: EventType.REASONING_MESSAGE_END,
        messageId,
      } as BaseEvent);
    }
    for (const messageId of openReasoningSpanIds) {
      appended.push({ type: EventType.REASONING_END, messageId } as BaseEvent);
    }

    for (const messageId of openMessageIds) {
      appended.push({
        type: EventType.TEXT_MESSAGE_END,
        messageId,
      } as BaseEvent);
    }

    for (const [toolCallId, info] of openToolCalls) {
      if (!info.hasEnd) {
        appended.push({
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } as BaseEvent);
      }

      if (!info.hasResult) {
        appended.push({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: `${toolCallId}-result`,
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
        } as BaseEvent);
      }
    }

    if (stopRequested) {
      // Newest first, so a nested subagent closes before its parent. An index
      // loop, because `toReversed` is ES2023 and this package targets older.
      const openIds = [...openSubagentRunIds];
      for (let index = openIds.length - 1; index >= 0; index -= 1) {
        appended.push({
          type: EventType.SUBAGENT_ERROR,
          subagentRunId: openIds[index],
          message: resolvedStopMessage,
          code: "CANCELLED",
        } as BaseEvent);
      }
      appended.push({
        type: EventType.RUN_FINISHED,
        ...(runIdentity.threadId !== undefined
          ? { threadId: runIdentity.threadId }
          : {}),
        ...(runIdentity.runId !== undefined
          ? { runId: runIdentity.runId }
          : {}),
        ...(options.protocolVersion !== undefined
          ? { outcome: { type: "cancelled" } }
          : {}),
      } as BaseEvent);
    } else {
      const errorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: resolvedAbruptMessage,
        code: "INCOMPLETE_STREAM",
      };
      appended.push(errorEvent);
    }

    terminalEventObserved = true;
    clearOpen();
    return appended;
  };

  return { observe, finalize };
}

/**
 * Array form of {@link createRunEventFinalizer} for callers that already keep
 * the run's events (runners persist them). Appends the closers to `events` in
 * place and returns them.
 */
export function finalizeRunEvents(
  events: BaseEvent[],
  options: FinalizeRunOptions = {},
): BaseEvent[] {
  const finalizer = createRunEventFinalizer();
  for (const event of events) finalizer.observe(event);

  const appended = finalizer.finalize(options);
  events.push(...appended);
  return appended;
}
