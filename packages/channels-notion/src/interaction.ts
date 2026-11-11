import type { InteractionEvent } from "@copilotkit/channels-core";
import type { PendingChoices } from "./conversation-state.js";

/**
 * Stable conversation key for one Notion discussion. Ingress (`onTurn`),
 * numbered-reply decoding (`onInteraction`), and the run renderer must all
 * derive the key from this one helper, or `awaitChoice` waiters never resolve.
 *
 * @param discussionId - The comment's `discussion_id`.
 * @example
 * conversationKeyOf("d1"); // "notion:d1"
 */
export function conversationKeyOf(discussionId: string) {
  return `notion:${discussionId}`;
}

/** Fields of an interaction that come from the reply comment, not from the choice. */
export type InteractionBase = Omit<
  InteractionEvent,
  "id" | "value" | "rawValue" | "messageRef"
>;

/** `2`, `#2`, or `2.` (surrounding space is trimmed first). */
const NUMBERED_REPLY = /^#?(\d+)\.?$/;

/**
 * Decode a reply comment into an `InteractionEvent` when it picks one of the
 * discussion's pending numbered choices.
 *
 * A reply picks a choice when its trimmed text is the choice number (`2`,
 * `#2`, or `2.`) or equals the choice label, ignoring case. Any other text
 * returns `undefined` and stays a normal turn.
 *
 * @param text - Reply text, with any leading bot mention or trigger removed.
 * @param pending - The numbered choices last posted in the discussion.
 * @param base - Conversation, reply target, actor, and identity of the reply.
 * @returns The event for `sink.onInteraction`. Its `id` is the choice
 *   `actionId`, `value` is the choice value, `rawValue` is the string form of a
 *   string or number value, and `messageRef` is the comment that listed the
 *   choices.
 */
export function decodeChoiceReply(
  text: string,
  pending: PendingChoices,
  base: InteractionBase,
) {
  const choice = pickChoice(text.trim(), pending);
  if (choice === undefined) return undefined;
  const rawValue = rawValueOf(choice.value);
  const event: InteractionEvent = {
    ...base,
    id: choice.actionId,
    value: choice.value,
    ...(rawValue === undefined ? {} : { rawValue }),
    messageRef: pending.messageRef,
  };
  return event;
}

function pickChoice(reply: string, pending: PendingChoices) {
  const numbered = NUMBERED_REPLY.exec(reply);
  const byIndex = numbered
    ? pending.choices.find((choice) => choice.index === Number(numbered[1]))
    : undefined;
  if (byIndex !== undefined) return byIndex;
  const label = reply.toLowerCase();
  return pending.choices.find(
    (choice) => choice.label.trim().toLowerCase() === label,
  );
}

function rawValueOf(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}
