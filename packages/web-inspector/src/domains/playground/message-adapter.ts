import type { Message } from "@ag-ui/client";
import { normalizeDisplayValue } from "../../shared/display/display-value.js";
import type { ThreadDebuggerMessage } from "../../shared/thread-debugger/types.js";
import type { PlaygroundMessage } from "./state.js";

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
  messages: readonly ThreadDebuggerMessage[],
): PlaygroundMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    contentText: message.content ?? "",
    toolCalls: (message.toolCalls ?? []).map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.name,
      arguments: parseToolArguments(toolCall.args),
    })),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.activityType ? { activityType: message.activityType } : {}),
  }));
}

export function mapPlaygroundMessagesToAgent(
  messages: readonly PlaygroundMessage[],
): Message[] {
  const mapped: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        id: message.id ?? "",
        role: "user",
        content: message.contentText,
      });
      continue;
    }
    if (message.role === "assistant") {
      mapped.push({
        id: message.id ?? "",
        role: "assistant",
        content: message.contentText,
        ...(message.toolCalls.length > 0
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id ?? "",
                type: "function" as const,
                function: {
                  name:
                    toolCall.function?.name ??
                    toolCall.toolName ??
                    "Unknown function",
                  arguments:
                    typeof (
                      toolCall.function?.arguments ?? toolCall.arguments
                    ) === "string"
                      ? String(
                          toolCall.function?.arguments ?? toolCall.arguments,
                        )
                      : JSON.stringify(
                          toolCall.function?.arguments ??
                            toolCall.arguments ??
                            {},
                        ),
                },
              })),
            }
          : {}),
      });
      continue;
    }
    if (message.role === "tool" && message.toolCallId) {
      mapped.push({
        id: message.id ?? "",
        role: "tool",
        content: message.contentText,
        toolCallId: message.toolCallId,
      });
    }
  }
  return mapped;
}
