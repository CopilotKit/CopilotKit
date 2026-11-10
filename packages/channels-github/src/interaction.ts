import type { InteractionEvent } from "@copilotkit/channels-core";
import type { PendingChoices } from "./pending-choices.js";
import type { GitHubMessageRef, ReplyTarget } from "./types.js";

/**
 * Stable conversation key for a GitHub reply target.
 *
 * An issue or PR conversation is `github:{owner}/{repo}#{issueNumber}`. A PR
 * review thread is `github:{owner}/{repo}#{issueNumber}/r{reviewCommentId}`.
 * Ingress, interaction decoding, and the pending-choice store all derive the
 * key from this one helper. A mismatch strands an `awaitChoice` waiter.
 *
 * @param target - The reply target of the event.
 */
export function conversationKeyOf(target: ReplyTarget) {
  const base = `github:${target.owner}/${target.repo}#${target.issueNumber}`;
  return target.reviewCommentId === undefined
    ? base
    : `${base}/r${target.reviewCommentId}`;
}

/**
 * Convert a GitHub comment ref to the engine's `MessageRef` shape.
 *
 * The engine keys message refs by a string `id`, so the numeric comment id
 * becomes its decimal string. The other fields stay as they are.
 *
 * @param ref - The GitHub comment ref.
 */
export function messageRefOf(ref: GitHubMessageRef) {
  return { ...ref, id: String(ref.id) };
}

/** Event fields a decoded choice reply shares with any other ingress event. */
export type ChoiceReplyBase = Omit<
  InteractionEvent,
  "id" | "value" | "rawValue" | "messageRef"
>;

const NUMBERED_REPLY = /^#?(\d+)\.?$/;

function findChoice(text: string, pending: PendingChoices) {
  const reply = text.trim();
  const numbered = NUMBERED_REPLY.exec(reply);
  if (numbered) {
    const index = Number(numbered[1]);
    return pending.choices.find((choice) => choice.index === index);
  }
  const label = reply.toLowerCase();
  return pending.choices.find(
    (choice) => choice.label.trim().toLowerCase() === label,
  );
}

function rawValueOf(value: unknown) {
  const isPrimitiveText =
    typeof value === "string" || typeof value === "number";
  return isPrimitiveText ? String(value) : undefined;
}

/**
 * Decode a comment that answers a pending numbered choice list.
 *
 * The trimmed text matches when it is a listed number (`2`, `#2`, or `2.`) or
 * equals an option label, ignoring case. A match becomes an
 * `InteractionEvent` with the control's action id, its value, the value's
 * string form as `rawValue` (for string and number values), and the ref of
 * the comment that posted the list.
 *
 * @param text - The reply comment text, with any bot mention removed.
 * @param pending - The conversation's pending choice set.
 * @param base - Conversation, reply target, actor, and identity facts of the reply.
 * @returns The interaction event, or `undefined` when the text matches no choice.
 */
export function decodeChoiceReply(
  text: string,
  pending: PendingChoices,
  base: ChoiceReplyBase,
) {
  const choice = findChoice(text, pending);
  if (choice === undefined) return undefined;
  const event: InteractionEvent = {
    ...base,
    id: choice.actionId,
    value: choice.value,
    rawValue: rawValueOf(choice.value),
    messageRef: messageRefOf(pending.messageRef),
  };
  return event;
}
