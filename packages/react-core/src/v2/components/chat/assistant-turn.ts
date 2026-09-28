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

  const assistantMessages = onePerId(
    messages
      .slice(start, end)
      .filter((m): m is AssistantMessage => m.role === "assistant"),
  );

  return {
    lastMessageId: assistantMessages[assistantMessages.length - 1]!.id,
    content: assistantMessages
      .map((m) => m.content?.trim())
      .filter(Boolean)
      .join("\n\n"),
    isLatest: end === messages.length,
  };
}

/**
 * For each assistant message, a key that changes whenever its turn-scoped
 * toolbar state can change: becoming (or ceasing to be) the turn's last
 * message, the reply's text changing, or the reply finishing. Memoized message
 * rows compare it so they re-render only when their toolbar would change.
 */
export function getAssistantTurnKeys(
  messages: Message[],
  isRunning: boolean,
): Map<string, string> {
  const keys = new Map<string, string>();
  let start = 0;
  while (start < messages.length) {
    let end = start;
    while (end < messages.length && messages[end]!.role !== "user") end++;

    const turn = onePerId(
      messages
        .slice(start, end)
        .filter((m): m is AssistantMessage => m.role === "assistant"),
    );
    const last = turn[turn.length - 1];
    if (last) {
      const contentLength = turn.reduce(
        (total, m) => total + (m.content?.length ?? 0),
        0,
      );
      const inProgress = isRunning && end === messages.length;
      for (const m of turn) {
        keys.set(
          m.id,
          m === last ? `last:${contentLength}:${inProgress}` : "inner",
        );
      }
    }
    start = end + 1;
  }
  return keys;
}
