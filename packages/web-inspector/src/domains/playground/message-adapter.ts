import type { Message } from "@ag-ui/client";
import { normalizeDisplayValue } from "../../shared/display/display-value.js";
import type { ThreadDebuggerMessage } from "../../shared/thread-debugger/types.js";
import type { PlaygroundMessage } from "./state.js";

type UserMessageContent = Extract<Message, { role: "user" }>["content"];

export type PlaygroundThreadMessage = Omit<ThreadDebuggerMessage, "content"> & {
  content?: UserMessageContent;
};

function parseToolArguments(
  args: string | Record<string, unknown>,
): ReturnType<typeof normalizeDisplayValue> {
  if (typeof args !== "string") {
    return normalizeDisplayValue(args);
  }
  try {
    const parsed: unknown = JSON.parse(args);
    return normalizeDisplayValue(parsed);
  } catch {
    return args;
  }
}

export function mapThreadMessagesToPlayground(
  messages: readonly PlaygroundThreadMessage[],
): PlaygroundMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    contentText:
      typeof message.content === "string"
        ? message.content
        : (message.content
            ?.flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n") ?? ""),
    toolCalls: (message.toolCalls ?? []).map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.name,
      arguments: parseToolArguments(toolCall.args),
    })),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.activityType ? { activityType: message.activityType } : {}),
  }));
}

export function mapThreadMessagesToAgent(
  messages: readonly PlaygroundThreadMessage[],
): Message[] {
  const mapped: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        id: message.id,
        role: "user",
        content: message.content ?? "",
      });
      continue;
    }
    if (message.role === "assistant") {
      mapped.push({
        id: message.id,
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        ...(message.toolCalls?.length
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function" as const,
                function: {
                  name: toolCall.name,
                  arguments:
                    typeof toolCall.args === "string"
                      ? toolCall.args
                      : JSON.stringify(toolCall.args),
                },
              })),
            }
          : {}),
      });
      continue;
    }
    if (message.role === "tool" && message.toolCallId) {
      mapped.push({
        id: message.id,
        role: "tool",
        content: typeof message.content === "string" ? message.content : "",
        toolCallId: message.toolCallId,
      });
    }
  }
  return mapped;
}
