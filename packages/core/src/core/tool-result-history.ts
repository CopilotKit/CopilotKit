import type { Message, ToolMessage } from "@ag-ui/client";

function normalizeToolResultContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .flatMap((part) => {
        if (typeof part === "string") return [part];
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return [(part as { text: string }).text];
        }
        return [];
      })
      .join("")
      .trim();
    return text.length > 0 ? text : null;
  }

  if (
    content &&
    typeof content === "object" &&
    "text" in content &&
    typeof (content as { text?: unknown }).text === "string"
  ) {
    return (content as { text: string }).text.trim();
  }

  return null;
}

export function isForwardedToClientPlaceholder(content: unknown): boolean {
  return normalizeToolResultContent(content) === "Forwarded to client";
}

export type MissingOwnerPolicy = "skip" | "append";

export type ToolResultHistoryResult =
  | { status: "inserted"; message: ToolMessage; index: number }
  | { status: "existing"; message: ToolMessage; index: number }
  | { status: "missing-owner" };

export function insertToolResultMessage(
  messages: Message[],
  toolMessage: ToolMessage,
  ownerMessageId?: string,
  missingOwnerPolicy: MissingOwnerPolicy = "skip",
): ToolResultHistoryResult {
  const existingIndex = messages.findIndex(
    (message) =>
      message.role === "tool" && message.toolCallId === toolMessage.toolCallId,
  );
  if (existingIndex !== -1) {
    return {
      status: "existing",
      message: messages[existingIndex] as ToolMessage,
      index: existingIndex,
    };
  }

  const explicitOwnerIndex =
    ownerMessageId === undefined
      ? -1
      : messages.findIndex(
          (message) =>
            message.role === "assistant" && message.id === ownerMessageId,
        );
  const ownerIndex =
    explicitOwnerIndex !== -1
      ? explicitOwnerIndex
      : messages.findIndex(
          (message) =>
            message.role === "assistant" &&
            message.toolCalls?.some(
              (toolCall: { id: string }) =>
                toolCall.id === toolMessage.toolCallId,
            ),
        );

  if (ownerIndex === -1) {
    if (missingOwnerPolicy === "append") {
      messages.push(toolMessage);
      return {
        status: "inserted",
        message: toolMessage,
        index: messages.length - 1,
      };
    }
    return { status: "missing-owner" };
  }

  let insertIndex = ownerIndex + 1;
  while (
    insertIndex < messages.length &&
    messages[insertIndex]?.role === "tool"
  ) {
    insertIndex++;
  }
  messages.splice(insertIndex, 0, toolMessage);
  return { status: "inserted", message: toolMessage, index: insertIndex };
}
