import type { BaseEvent, RunErrorEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";

export interface FinalizeRunOptions {
  stopRequested?: boolean;
  interruptionMessage?: string;
}

export interface RunEventFinalizerOptions {
  /** Maximum number of text and tool lifecycles that may be open concurrently. */
  maxOpenLifecycles: number;
}

export interface RunEventFinalizerSnapshot {
  terminalEventObserved: boolean;
  openTextMessageIds: readonly string[];
  openToolCalls: readonly {
    toolCallId: string;
    missingEnd: boolean;
    missingResult: boolean;
  }[];
}

export interface RunEventFinalizer {
  /** Observe one streamed event without retaining its payload. */
  observe(event: BaseEvent): void;
  /** Return the events needed to close an interrupted or abruptly ended stream. */
  finalize(options?: FinalizeRunOptions): BaseEvent[];
  /** Return compact diagnostic state. Payloads from observed events are never included. */
  snapshot(): RunEventFinalizerSnapshot;
}

export class RunEventFinalizerOverflowError extends Error {
  readonly code = "RUN_EVENT_FINALIZER_OVERFLOW";

  constructor(readonly maxOpenLifecycles: number) {
    super(
      `Run event finalizer exceeded its ${maxOpenLifecycles} open lifecycle budget`,
    );
    this.name = "RunEventFinalizerOverflowError";
  }
}

const defaultStopMessage = "Run stopped by user";
const defaultAbruptEndMessage = "Run ended without emitting a terminal event";

interface OpenToolCall {
  hasEnd: boolean;
  hasResult: boolean;
}

/**
 * Track only the state needed to safely terminate a stream. Completed lifecycle
 * IDs are removed immediately, and event payloads are never retained.
 */
export function createRunEventFinalizer({
  maxOpenLifecycles,
}: RunEventFinalizerOptions): RunEventFinalizer {
  if (!Number.isSafeInteger(maxOpenLifecycles) || maxOpenLifecycles < 0) {
    throw new TypeError(
      "maxOpenLifecycles must be a non-negative safe integer",
    );
  }

  const openMessageIds = new Set<string>();
  const openToolCalls = new Map<string, OpenToolCall>();
  let terminalEventObserved = false;

  const reserveLifecycle = () => {
    if (openMessageIds.size + openToolCalls.size >= maxOpenLifecycles) {
      throw new RunEventFinalizerOverflowError(maxOpenLifecycles);
    }
  };

  const observe = (event: BaseEvent) => {
    if (terminalEventObserved) return;

    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        const messageId = (event as { messageId?: string }).messageId;
        if (messageId && !openMessageIds.has(messageId)) {
          reserveLifecycle();
          openMessageIds.add(messageId);
        }
        break;
      }
      case EventType.TEXT_MESSAGE_END: {
        const messageId = (event as { messageId?: string }).messageId;
        if (typeof messageId === "string") openMessageIds.delete(messageId);
        break;
      }
      case EventType.TOOL_CALL_START: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (toolCallId) {
          if (!openToolCalls.has(toolCallId)) reserveLifecycle();
          openToolCalls.set(toolCallId, { hasEnd: false, hasResult: false });
        }
        break;
      }
      case EventType.TOOL_CALL_END:
      case EventType.TOOL_CALL_RESULT: {
        const toolCallId = (event as { toolCallId?: string }).toolCallId;
        if (!toolCallId) break;

        const info = openToolCalls.get(toolCallId);
        if (info) {
          if (event.type === EventType.TOOL_CALL_END) info.hasEnd = true;
          else info.hasResult = true;

          if (info.hasEnd && info.hasResult) openToolCalls.delete(toolCallId);
        }
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

  const snapshot = (): RunEventFinalizerSnapshot => ({
    terminalEventObserved,
    openTextMessageIds: [...openMessageIds],
    openToolCalls: [...openToolCalls].map(([toolCallId, info]) => ({
      toolCallId,
      missingEnd: !info.hasEnd,
      missingResult: !info.hasResult,
    })),
  });

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

  return { observe, finalize, snapshot };
}

/**
 * Backwards-compatible array API. New streaming callers should use
 * `createRunEventFinalizer` so event payloads can be released immediately.
 */
export function finalizeRunEvents(
  events: BaseEvent[],
  options: FinalizeRunOptions = {},
): BaseEvent[] {
  const finalizer = createRunEventFinalizer({
    // The caller already retained the full array. Preserve the legacy API's
    // unbounded lifecycle behavior while sharing the compact reducer.
    maxOpenLifecycles: Number.MAX_SAFE_INTEGER,
  });
  for (const event of events) finalizer.observe(event);

  const appended = finalizer.finalize(options);
  events.push(...appended);
  return appended;
}
