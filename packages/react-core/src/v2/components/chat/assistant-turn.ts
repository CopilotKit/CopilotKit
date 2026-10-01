import type { AssistantMessage, Message } from "@ag-ui/core";

/**
 * Everything an assistant produced in reply to one user message: the
 * assistant messages after a user message, up to the next user message. A
 * single user input can yield several assistant messages (text, tool calls,
 * more text across runs); to the user they read as one reply.
 */
export interface AssistantTurn {
  /** Id of the turn's last assistant message — the one that shows the toolbar. */
  lastMessageId: string;
  /** Text of every assistant message in the turn, joined by blank lines. */
  content: string;
  /** True when no user message follows the turn (it may still be streaming). */
  isLatest: boolean;
}

/**
 * A turn's assistant messages, one per id. Streaming can put two copies of a
 * message in the list, and the view shows them as one row (see
 * `deduplicateMessages`): the later copy wins, but an empty one keeps the
 * earlier text.
 */
function onePerId(messages: AssistantMessage[]): AssistantMessage[] {
  const byId = new Map<string, AssistantMessage>();
  for (const message of messages) {
    const earlier = byId.get(message.id);
    byId.set(
      message.id,
      earlier && !message.content
        ? { ...message, content: earlier.content }
        : message,
    );
  }
  return [...byId.values()];
}

/** The turn of every assistant message in `messages`, keyed by message id. */
export function getAssistantTurns(
  messages: Message[],
): Map<string, AssistantTurn> {
  const turns = new Map<string, AssistantTurn>();
  let start = 0;
  while (start < messages.length) {
    let end = start;
    while (end < messages.length && messages[end]!.role !== "user") end++;

    const assistantMessages = onePerId(
      messages
        .slice(start, end)
        .filter((m): m is AssistantMessage => m.role === "assistant"),
    );
    const last = assistantMessages[assistantMessages.length - 1];
    if (last) {
      const turn: AssistantTurn = {
        lastMessageId: last.id,
        content: assistantMessages
          .map((m) => m.content?.trim())
          .filter(Boolean)
          .join("\n\n"),
        isLatest: end === messages.length,
      };
      for (const m of assistantMessages) turns.set(m.id, turn);
    }
    start = end + 1;
  }
  return turns;
}

/** Returns the turn containing `messageId`, or `undefined` if it isn't an assistant message in `messages`. */
export function getAssistantTurn(
  messages: Message[],
  messageId: string,
): AssistantTurn | undefined {
  return getAssistantTurns(messages).get(messageId);
}
