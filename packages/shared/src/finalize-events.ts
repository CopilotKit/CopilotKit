import type { BaseEvent, RunErrorEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

export interface FinalizeRunOptions {
  stopRequested?: boolean;
  interruptionMessage?: string;
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
 * the closers for text messages and tool calls still open plus a terminal
 * event. Closed lifecycles are forgotten at once and payloads are never kept,
 * so a caller does not have to retain the event array for this purpose.
 */
export function createRunEventFinalizer(): RunEventFinalizer {
  const openMessageIds = new Set<string>();
  const openToolCalls = new Map<string, OpenToolCall>();
  let terminalEventObserved = false;

  const observe = (event: BaseEvent) => {
    if (terminalEventObserved) return;

    switch (event.type) {
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
      case EventType.RUN_FINISHED:
      case EventType.RUN_ERROR:
        terminalEventObserved = true;
        openMessageIds.clear();
        openToolCalls.clear();
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
      appended.push({ type: EventType.RUN_FINISHED } as BaseEvent);
    } else {
      const errorEvent: RunErrorEvent = {
        type: EventType.RUN_ERROR,
        message: resolvedAbruptMessage,
        code: "INCOMPLETE_STREAM",
      };
      appended.push(errorEvent);
    }

    terminalEventObserved = true;
    openMessageIds.clear();
    openToolCalls.clear();
    return appended;
  };

  return { observe, finalize };
}

/**
 * Array form of {@link createRunEventFinalizer} for callers that already keep
 * the run's events (runners persist them). Appends the closers to `events` in
 * place and returns them.
 *
 * If the terminal event (`RUN_FINISHED` or `RUN_ERROR`) is already present in
 * the array (e.g. the run was aborted while a tool call was still open), the
 * lifecycle closers are spliced in BEFORE it so that `compactEvents` sees a
 * well-ordered stream and does not carry the open tool call past the terminal.
 */
export function finalizeRunEvents(
  events: BaseEvent[],
  options: FinalizeRunOptions = {},
): BaseEvent[] {
  const finalizer = createRunEventFinalizer();

  // Observe events one at a time and stop at the first terminal event so the
  // finalizer knows which lifecycles are still open at that point.
  let terminalIdx = -1;
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.type === EventType.RUN_FINISHED || evt.type === EventType.RUN_ERROR) {
      terminalIdx = i;
      break;
    }
    finalizer.observe(evt);
  }

  if (terminalIdx === -1) {
    // No terminal in the stream yet — original path: append closers + terminal.
    const appended = finalizer.finalize(options);
    events.push(...appended);
    return appended;
  }

  // Terminal already present. Ask the finalizer what is still open before it.
  // finalize() will produce lifecycle closers + a synthetic terminal; we keep
  // only the closers because the real terminal is already in the array.
  const all = finalizer.finalize(options);
  const lifecycleClosers = all.filter(
    (e) => e.type !== EventType.RUN_FINISHED && e.type !== EventType.RUN_ERROR,
  );

  if (lifecycleClosers.length === 0) return [];

  // Splice the closers immediately before the existing terminal event so the
  // stored sequence is valid and compactEvents does not reorder across it.
  events.splice(terminalIdx, 0, ...lifecycleClosers);

  // Return an empty array: the terminal has already been emitted to live
  // subscribers by the runner before finalizeRunEvents was called.  Returning
  // the closers would cause the runner to emit them AFTER the terminal, which
  // is the same invalid order we are fixing for replay. History is correct
  // from the splice above; live-stream closer ordering requires buffering the
  // terminal at the runner level, which is a separate concern.
  return [];
}
