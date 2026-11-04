import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore } from "@copilotkit/core";

/** Trajectory event name for a rating of one assistant message. */
export const MESSAGE_FEEDBACK_EVENT_NAME = "message.feedback";

/** Longest comment kept, in characters; the rest is cut so the event stays small. */
export const MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH = 1000;

/** Longest excerpt of the rated response sent with the rating, in characters. */
const RESPONSE_EXCERPT_LENGTH = 500;

export type MessageFeedbackRating = "up" | "down";

/** The rating this page gave one assistant message. */
export interface MessageFeedback {
  readonly rating: MessageFeedbackRating;
  readonly comment?: string;
}

// Ratings given on this page, by message. Kept outside React, so a rated
// message that scrolls out of a virtual list still shows its rating when it
// comes back. Intelligence holds the ratings across page loads.
const ratings = new Map<string, MessageFeedback>();
const listeners = new Map<string, Set<() => void>>();

const threadKey = (agentId: string, threadId: string) =>
  JSON.stringify([agentId, threadId]);

const messageKey = (agentId: string, threadId: string, messageId: string) =>
  JSON.stringify([agentId, threadId, messageId]);

/** Cuts `text` to `max` characters without splitting a surrogate pair. */
const clip = (text: string, max: number): string => {
  const characters = Array.from(text);
  return characters.length > max ? characters.slice(0, max).join("") : text;
};

/** The comment as kept and sent: trimmed and capped, or none. */
const normalizeComment = (comment: unknown): string | undefined => {
  if (typeof comment !== "string") return undefined;
  const text = clip(comment.trim(), MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH);
  return text === "" ? undefined : text;
};

/** The rating this page gave one message, if any. */
export function getMessageFeedback(
  agentId: string,
  threadId: string,
  messageId: string,
): MessageFeedback | undefined {
  return ratings.get(messageKey(agentId, threadId, messageId));
}

/** Calls `listener` whenever a rating in this Thread changes. */
export function subscribeToMessageFeedback(
  agentId: string,
  threadId: string,
  listener: () => void,
): () => void {
  const key = threadKey(agentId, threadId);
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Sets (or, with `null`, clears) this page's rating of one message and sends
 * it to the active Trajectory. Every change is a new event; the newest event
 * for a `feedbackId` is the current one. Like any Trajectory event, a change
 * made while no Trajectory captures, for example during a reconnect, is not
 * sent; the page still shows it.
 */
export function setMessageFeedback(params: {
  copilotkit: CopilotKitCore;
  agentId: string;
  threadId: string;
  message: AssistantMessage;
  feedback: MessageFeedback | null;
}): void {
  const { copilotkit, agentId, threadId, message } = params;
  const comment = normalizeComment(params.feedback?.comment);
  const feedback: MessageFeedback | null = params.feedback && {
    rating: params.feedback.rating,
    ...(comment ? { comment } : {}),
  };

  const key = messageKey(agentId, threadId, message.id);
  if (feedback) ratings.set(key, feedback);
  else ratings.delete(key);
  for (const listener of listeners.get(threadKey(agentId, threadId)) ?? [])
    listener();

  const runId = copilotkit.getRunIdForMessage(agentId, threadId, message.id);
  copilotkit.emitTrajectoryEvent(MESSAGE_FEEDBACK_EVENT_NAME, {
    feedbackId: `${threadId}:${message.id}`,
    threadId,
    messageId: message.id,
    agentId,
    ...(runId ? { runId } : {}),
    rating: feedback?.rating ?? null,
    ...(feedback?.comment ? { comment: feedback.comment } : {}),
    // A custom sink set to omit agent text gets no excerpt of the reply.
    ...(copilotkit.ɵlearningCapturesAgentText
      ? { response: clip(message.content ?? "", RESPONSE_EXCERPT_LENGTH) }
      : {}),
  });
}

/** @internal Forgets every rating, so each test starts empty. */
export function ɵresetMessageFeedbackCache(): void {
  ratings.clear();
}
