export type FeedbackKind = "thumbsUp" | "thumbsDown";

export type MessageFeedbackMap = Record<string, FeedbackKind>;

/**
 * The feedback state a click on `kind` transitions to.
 *
 * Clicking the button that is already active retracts the feedback, so the
 * click deactivates it; every other click applies feedback.
 */
export function isActivatingClick(
  current: FeedbackKind | null | undefined,
  kind: FeedbackKind,
): boolean {
  return current !== kind;
}

/**
 * Applies a feedback click to the message-id keyed map.
 *
 * A deactivating click removes the entry entirely rather than storing a falsy
 * value, so `messageFeedback[id]` stays absent for "no feedback given".
 */
export function applyFeedbackClick(
  previous: MessageFeedbackMap,
  messageId: string,
  kind: FeedbackKind,
  isActive: boolean,
): MessageFeedbackMap {
  if (!isActive) {
    if (!(messageId in previous)) return previous;
    const { [messageId]: _retracted, ...rest } = previous;
    return rest;
  }

  if (previous[messageId] === kind) return previous;
  return { ...previous, [messageId]: kind };
}
