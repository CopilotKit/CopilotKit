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
const defaultRunErrorMessage = "Run ended with an error";

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
  // Open steps as a stack: each entry is { stepName, subagentRunId? }.
  // STEP_STARTED pushes; STEP_FINISHED pops the most-recent matching name.
  const openSteps: Array<{ stepName: string; subagentRunId?: string }> = [];
  // Insertion order is start order, so closing in reverse closes children first.
  const openSubagentRunIds = new Set<string>();
  let runIdentity: { threadId?: string; runId?: string } = {};
  let terminalEventObserved = false;

  const clearOpen = () => {
    openMessageIds.clear();
    openReasoningMessageIds.clear();
    openReasoningSpanIds.clear();
    openToolCalls.clear();
    openSteps.length = 0;
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
      case EventType.STEP_STARTED: {
        const stepName = (event as { stepName?: string }).stepName;
        if (stepName) {
          const subagentRunId = (event as { subagentRunId?: string })
            .subagentRunId;
          openSteps.push({ stepName, subagentRunId });
        }
        break;
      }
      case EventType.STEP_FINISHED: {
        const stepName = (event as { stepName?: string }).stepName;
        if (stepName) {
          // Remove the most-recently opened step with this name.
          for (let i = openSteps.length - 1; i >= 0; i--) {
            if (openSteps[i].stepName === stepName) {
              openSteps.splice(i, 1);
              break;
            }
          }
        }
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

    // Close open steps in reverse order (last opened, first closed).
    for (let i = openSteps.length - 1; i >= 0; i--) {
      const { stepName, subagentRunId } = openSteps[i];
      appended.push({
        type: EventType.STEP_FINISHED,
        stepName,
        ...(subagentRunId !== undefined && { subagentRunId }),
      } as BaseEvent);
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
 * the run's events (runners persist them).
 *
 * When no terminal event is present, closers and a terminal are appended to
 * `events` in place and returned.
 *
 * When the terminal event (`RUN_FINISHED` or `RUN_ERROR`) is already present
 * (e.g. the run was aborted while a tool call was still open), the lifecycle
 * closers are spliced in BEFORE it so that `compactEvents` sees a well-ordered
 * stream on replay. In this case an empty array is returned because the
 * terminal has already been emitted to live subscribers; returning the closers
 * would cause the runner to re-emit them after the terminal, producing the
 * same invalid order that the splice is meant to fix.
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
    if (
      evt.type === EventType.RUN_FINISHED ||
      evt.type === EventType.RUN_ERROR
    ) {
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
  // When the existing terminal is RUN_ERROR, use its message so the synthetic
  // TOOL_CALL_RESULT describes what actually happened instead of saying the run
  // ended without a terminal event.
  const terminalEvt = events[terminalIdx];
  let finalizeOptions = options;
  if (
    terminalEvt.type === EventType.RUN_ERROR &&
    !options.interruptionMessage
  ) {
    const errMsg = (terminalEvt as RunErrorEvent).message;
    finalizeOptions = {
      ...options,
      interruptionMessage: errMsg || defaultRunErrorMessage,
    };
  }
  const all = finalizer.finalize(finalizeOptions);
  const lifecycleClosers = all.filter(
    (e) => e.type !== EventType.RUN_FINISHED && e.type !== EventType.RUN_ERROR,
  );

  if (lifecycleClosers.length === 0) return [];

  // Splice the closers immediately before the existing terminal event so the
  // stored sequence is valid and compactEvents does not reorder across it.
  events.splice(terminalIdx, 0, ...lifecycleClosers);

  // Return an empty array: the terminal has already been emitted to live
  // subscribers by the runner before finalizeRunEvents was called. Returning
  // the closers would cause the runner to emit them AFTER the terminal, which
  // is the same invalid order we are fixing for replay. History is correct
  // from the splice above; live-stream closer ordering requires buffering the
  // terminal at the runner level, which is a separate concern.
  return [];
}
