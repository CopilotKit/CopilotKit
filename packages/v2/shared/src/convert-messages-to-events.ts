import { BaseEvent, EventType, Message } from "@ag-ui/client";

/**
 * Converts an array of messages to BaseEvent array.
 * Used for importing external run history into the event store.
 *
 * Wraps messages in RUN_STARTED and RUN_FINISHED events.
 * Converts:
 * - User/system/developer messages to TEXT_MESSAGE events
 * - Assistant messages with content to TEXT_MESSAGE events
 * - Assistant messages with tool calls to TOOL_CALL events
 * - Tool messages to TOOL_CALL_RESULT events
 */
export function convertMessagesToEvents(
  threadId: string,
  runId: string,
  messages: Message[],
): BaseEvent[] {
  const events: BaseEvent[] = [];

  // RunStartedEvent
  events.push({
    type: EventType.RUN_STARTED,
    threadId,
    runId,
  } as BaseEvent);

  for (const message of messages) {
    if (
      message.role === "user" ||
      message.role === "system" ||
      message.role === "developer"
    ) {
      // Text message: START -> CONTENT -> END
      if (message.content) {
        events.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: message.id,
          role: message.role,
        } as BaseEvent);
        events.push({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: message.id,
          delta: message.content,
        } as BaseEvent);
        events.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId: message.id,
        } as BaseEvent);
      }
    } else if (message.role === "assistant") {
      // Assistant message may have content and/or tool calls
      if (message.content) {
        events.push({
          type: EventType.TEXT_MESSAGE_START,
          messageId: message.id,
          role: "assistant",
        } as BaseEvent);
        events.push({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: message.id,
          delta: message.content,
        } as BaseEvent);
        events.push({
          type: EventType.TEXT_MESSAGE_END,
          messageId: message.id,
        } as BaseEvent);
      }

      // Tool calls
      if ("toolCalls" in message && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          events.push({
            type: EventType.TOOL_CALL_START,
            toolCallId: toolCall.id,
            toolCallName: toolCall.function.name,
            parentMessageId: message.id,
          } as BaseEvent);
          events.push({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: toolCall.id,
            delta: toolCall.function.arguments,
          } as BaseEvent);
          events.push({
            type: EventType.TOOL_CALL_END,
            toolCallId: toolCall.id,
          } as BaseEvent);
        }
      }
    } else if (message.role === "tool") {
      // Tool result message
      events.push({
        type: EventType.TOOL_CALL_RESULT,
        messageId: message.id,
        toolCallId: message.toolCallId,
        content: message.content,
        role: "tool",
      } as BaseEvent);
    }
  }

  // RunFinishedEvent
  events.push({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
  } as BaseEvent);

  return events;
}
