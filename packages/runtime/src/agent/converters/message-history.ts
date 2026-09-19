import type { Message } from "@ag-ui/client";

/**
 * Removes tool calls from assistant history when no tool result was persisted.
 * AI SDK requires every tool call in a replayed assistant message to have a
 * matching result before it can send the next model request.
 */
export function filterUnansweredToolCalls(
  messages: Message[],
  additionalAnsweredToolCallIds?: ReadonlySet<string>,
): Message[] {
  const answeredToolCallIds = new Set(additionalAnsweredToolCallIds);
  for (const message of messages) {
    if (message.role === "tool" && typeof message.toolCallId === "string") {
      answeredToolCallIds.add(message.toolCallId);
    }
  }

  const assistantToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        if (typeof toolCall.id === "string") {
          assistantToolCallIds.add(toolCall.id);
        }
      }
    }
  }

  return messages.flatMap((message, index) => {
    if (message.role === "tool") {
      // Also discard stale results whose originating assistant call is absent.
      if (
        typeof message.toolCallId === "string" &&
        assistantToolCallIds.size > 0 &&
        !assistantToolCallIds.has(message.toolCallId)
      ) {
        return [];
      }
      return [message];
    }

    if (message.role !== "assistant" || !message.toolCalls?.length) {
      return [message];
    }

    const toolCalls = message.toolCalls.filter((toolCall) =>
      answeredToolCallIds.has(toolCall.id),
    );
    if (toolCalls.length === message.toolCalls.length) {
      return [message];
    }

    // A final assistant tool call can still be waiting for a client-side
    // resume. Only sanitize calls that are followed by another turn.
    const hasLaterTurn = messages
      .slice(index + 1)
      .some(
        (nextMessage) =>
          nextMessage.role === "user" || nextMessage.role === "assistant",
      );
    if (!hasLaterTurn) {
      return [message];
    }

    const { toolCalls: _unansweredToolCalls, ...withoutToolCalls } = message;
    if (toolCalls.length === 0 && !message.content) {
      return [];
    }

    return [
      toolCalls.length > 0
        ? { ...message, toolCalls }
        : (withoutToolCalls as Message),
    ];
  });
}
