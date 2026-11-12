/*
 * The docs' side chat hands its conversation to the full-page chat at /ask:
 * "Open full page" keeps the messages for this tab, and /ask picks them up
 * once. Images can outgrow the tab's storage, so they drop out first.
 */

const KEY = "cpk-ask-handoff";

type Message = { id: string; role: string; content?: unknown };

/** A message without its attachments (every non-text part). */
function textOnly(message: Message): Message {
  if (!Array.isArray(message.content)) return message;
  return {
    ...message,
    content: (message.content as { type?: string }[]).filter(
      (part) => part?.type === "text",
    ),
  };
}

export function stashConversation(messages: readonly Message[]) {
  if (!messages.length) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(messages));
  } catch {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(messages.map(textOnly)));
    } catch {
      // Too long to carry over; /ask starts a new chat.
    }
  }
}

/** The conversation handed over, once; null when there is none. */
export function takeConversation(): Message[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    const messages = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(messages) && messages.length
      ? (messages as Message[])
      : null;
  } catch {
    return null;
  }
}
