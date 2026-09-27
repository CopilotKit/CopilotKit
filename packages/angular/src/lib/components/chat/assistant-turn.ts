import type { AssistantMessage, Message } from "@ag-ui/core";

/**
 * Everything an assistant produced in reply to one user message: the
 * assistant messages after a user message, up to the next user message. A
 * single user input can yield several assistant messages (text, tool calls,
 * more text across runs); to the user they read as one reply.
 *
 * Mirrors `packages/react-core/src/v2/components/chat/assistant-turn.ts`.
 */
export interface AssistantTurn {
  /** Id of the turn's last assistant message — the one that shows the toolbar. */
  lastMessageId: string;
  /** Text of every assistant message in the turn, joined by blank lines. */
  content: string;
  /** True when no user message follows the turn (it may still be streaming). */
  isLatest: boolean;
}

/** Returns the turn containing `messageId`, or `undefined` if it isn't an assistant message in `messages`. */
export function getAssistantTurn(
  messages: Message[],
  messageId: string,
): AssistantTurn | undefined {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1 || messages[index]!.role !== "assistant") return undefined;

  let start = index;
  while (start > 0 && messages[start - 1]!.role !== "user") start--;
  let end = index + 1;
  while (end < messages.length && messages[end]!.role !== "user") end++;

  const assistantMessages = messages
    .slice(start, end)
    .filter((m): m is AssistantMessage => m.role === "assistant");

  return {
    lastMessageId: assistantMessages[assistantMessages.length - 1]!.id,
    content: assistantMessages
      .map((m) => m.content?.trim())
      .filter(Boolean)
      .join("\n\n"),
    isLatest: end === messages.length,
  };
}
