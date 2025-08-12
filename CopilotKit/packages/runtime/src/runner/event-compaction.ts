import {
  BaseEvent,
  EventType,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
} from "@ag-ui/client";

/**
 * Compacts streaming events by consolidating multiple deltas into single events.
 * For text messages: multiple content deltas become one concatenated delta.
 * For tool calls: multiple args deltas become one concatenated delta.
 * Events between related streaming events are reordered to keep streaming events together.
 *
 * @param events - Array of events to compact
 * @returns Compacted array of events
 */
export function compactEvents(events: BaseEvent[]): BaseEvent[] {
  const compacted: BaseEvent[] = [];
  const pendingTextMessages = new Map<
    string,
    {
      start?: TextMessageStartEvent;
      contents: TextMessageContentEvent[];
      end?: TextMessageEndEvent;
      otherEvents: BaseEvent[];
    }
  >();
  const pendingToolCalls = new Map<
    string,
    {
      start?: ToolCallStartEvent;
      args: ToolCallArgsEvent[];
      end?: ToolCallEndEvent;
      otherEvents: BaseEvent[];
    }
  >();

  for (const event of events) {
    // Handle text message streaming events
    if (event.type === EventType.TEXT_MESSAGE_START) {
      const startEvent = event as TextMessageStartEvent;
      const messageId = startEvent.messageId;

      if (!pendingTextMessages.has(messageId)) {
        pendingTextMessages.set(messageId, {
          contents: [],
          otherEvents: [],
        });
      }

      const pending = pendingTextMessages.get(messageId)!;
      pending.start = startEvent;
    } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      const contentEvent = event as TextMessageContentEvent;
      const messageId = contentEvent.messageId;

      if (!pendingTextMessages.has(messageId)) {
        pendingTextMessages.set(messageId, {
          contents: [],
          otherEvents: [],
        });
      }

      const pending = pendingTextMessages.get(messageId)!;
      pending.contents.push(contentEvent);
    } else if (event.type === EventType.TEXT_MESSAGE_END) {
      const endEvent = event as TextMessageEndEvent;
      const messageId = endEvent.messageId;

      if (!pendingTextMessages.has(messageId)) {
        pendingTextMessages.set(messageId, {
          contents: [],
          otherEvents: [],
        });
      }

      const pending = pendingTextMessages.get(messageId)!;
      pending.end = endEvent;

      // Flush this message's events
      flushTextMessage(messageId, pending, compacted);
      pendingTextMessages.delete(messageId);
    } else if (event.type === EventType.TOOL_CALL_START) {
      const startEvent = event as ToolCallStartEvent;
      const toolCallId = startEvent.toolCallId;

      if (!pendingToolCalls.has(toolCallId)) {
        pendingToolCalls.set(toolCallId, {
          args: [],
          otherEvents: [],
        });
      }

      const pending = pendingToolCalls.get(toolCallId)!;
      pending.start = startEvent;
    } else if (event.type === EventType.TOOL_CALL_ARGS) {
      const argsEvent = event as ToolCallArgsEvent;
      const toolCallId = argsEvent.toolCallId;

      if (!pendingToolCalls.has(toolCallId)) {
        pendingToolCalls.set(toolCallId, {
          args: [],
          otherEvents: [],
        });
      }

      const pending = pendingToolCalls.get(toolCallId)!;
      pending.args.push(argsEvent);
    } else if (event.type === EventType.TOOL_CALL_END) {
      const endEvent = event as ToolCallEndEvent;
      const toolCallId = endEvent.toolCallId;

      if (!pendingToolCalls.has(toolCallId)) {
        pendingToolCalls.set(toolCallId, {
          args: [],
          otherEvents: [],
        });
      }

      const pending = pendingToolCalls.get(toolCallId)!;
      pending.end = endEvent;

      // Flush this tool call's events
      flushToolCall(toolCallId, pending, compacted);
      pendingToolCalls.delete(toolCallId);
    } else {
      // For non-streaming events, check if we're in the middle of any streaming sequences
      let addedToBuffer = false;

      // Check text messages
      for (const [messageId, pending] of Array.from(pendingTextMessages)) {
        // If we have a start but no end yet, this event is "in between"
        if (pending.start && !pending.end) {
          pending.otherEvents.push(event);
          addedToBuffer = true;
          break;
        }
      }

      // Check tool calls if not already buffered
      if (!addedToBuffer) {
        for (const [toolCallId, pending] of Array.from(pendingToolCalls)) {
          // If we have a start but no end yet, this event is "in between"
          if (pending.start && !pending.end) {
            pending.otherEvents.push(event);
            addedToBuffer = true;
            break;
          }
        }
      }

      // If not in the middle of any streaming sequence, add directly to compacted
      if (!addedToBuffer) {
        compacted.push(event);
      }
    }
  }

  // Flush any remaining incomplete messages
  for (const [messageId, pending] of Array.from(pendingTextMessages)) {
    flushTextMessage(messageId, pending, compacted);
  }

  // Flush any remaining incomplete tool calls
  for (const [toolCallId, pending] of Array.from(pendingToolCalls)) {
    flushToolCall(toolCallId, pending, compacted);
  }

  return compacted;
}

function flushTextMessage(
  messageId: string,
  pending: {
    start?: TextMessageStartEvent;
    contents: TextMessageContentEvent[];
    end?: TextMessageEndEvent;
    otherEvents: BaseEvent[];
  },
  compacted: BaseEvent[],
): void {
  // Add start event if present
  if (pending.start) {
    compacted.push(pending.start);
  }

  // Compact all content events into one
  if (pending.contents.length > 0) {
    const concatenatedDelta = pending.contents.map((c) => c.delta).join("");

    const compactedContent: TextMessageContentEvent = {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: messageId,
      delta: concatenatedDelta,
    };

    compacted.push(compactedContent);
  }

  // Add end event if present
  if (pending.end) {
    compacted.push(pending.end);
  }

  // Add any events that were in between
  for (const otherEvent of pending.otherEvents) {
    compacted.push(otherEvent);
  }
}

function flushToolCall(
  toolCallId: string,
  pending: {
    start?: ToolCallStartEvent;
    args: ToolCallArgsEvent[];
    end?: ToolCallEndEvent;
    otherEvents: BaseEvent[];
  },
  compacted: BaseEvent[],
): void {
  // Add start event if present
  if (pending.start) {
    compacted.push(pending.start);
  }

  // Compact all args events into one
  if (pending.args.length > 0) {
    const concatenatedArgs = pending.args.map((a) => a.delta).join("");

    const compactedArgs: ToolCallArgsEvent = {
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: toolCallId,
      delta: concatenatedArgs,
    };

    compacted.push(compactedArgs);
  }

  // Add end event if present
  if (pending.end) {
    compacted.push(pending.end);
  }

  // Add any events that were in between
  for (const otherEvent of pending.otherEvents) {
    compacted.push(otherEvent);
  }
}
