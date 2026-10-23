import type {
  AssistantMessage,
  Message,
  ToolCall,
  ToolMessage,
} from "@ag-ui/core";

/** Build model input without removing pending frontend calls from client history. */
export function modelToolHistory(messages: Message[]): Message[] {
  const pending = new Map<
    string,
    { owner: AssistantMessage; call: ToolCall }
  >();
  const completed = new Map<AssistantMessage, Map<ToolCall, ToolMessage>>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) {
        if (call.function.name.trim()) {
          pending.set(call.id, { owner: message, call });
        }
      }
    } else if (message.role === "tool") {
      const match = pending.get(message.toolCallId);
      if (!match) continue;
      const results =
        completed.get(match.owner) ?? new Map<ToolCall, ToolMessage>();
      results.set(match.call, message);
      completed.set(match.owner, results);
      pending.delete(message.toolCallId);
    }
  }

  return messages.flatMap((message): Message[] => {
    if (message.role === "tool") return [];
    if (message.role !== "assistant" || !message.toolCalls?.length) {
      return [message];
    }
    const results = completed.get(message);
    const calls = message.toolCalls.filter((call) => results?.has(call));
    if (calls.length > 0) {
      return [
        { ...message, toolCalls: calls },
        ...calls.map((call) => results!.get(call)!),
      ];
    }
    const { toolCalls: _toolCalls, ...text } = message;
    return message.content ? [text] : [];
  });
}
