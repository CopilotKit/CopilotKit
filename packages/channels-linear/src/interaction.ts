import type { InteractionEvent } from "@copilotkit/channels-core";
import type { PendingChoiceSet } from "./pending-choices.js";

/**
 * Stable conversation key for one Linear agent session. Ingress, interaction
 * decoding, and the adapter must all derive the key from this helper: a
 * mismatch strands an `awaitChoice` waiter.
 *
 * @param agentSessionId - The Linear agent session id.
 * @example conversationKeyOf("ses_1") // "linear:ses_1"
 */
export function conversationKeyOf(agentSessionId: string) {
  return `linear:${agentSessionId}`;
}

/** Ingress fields an interaction shares with the turn it came from. */
export type InteractionEventBase = Omit<
  InteractionEvent,
  "id" | "value" | "rawValue" | "messageRef" | "values" | "triggerId"
>;

/**
 * Decode a `prompt` body as a pick from the pending `select` elicitation.
 *
 * Linear returns a picked option as a plain user message whose body is the
 * option value. The trimmed body matches an option when it equals the
 * option's `optionValue`, or, failing that, its label ignoring case. Returns
 * `undefined` when nothing matches, so the body stays an ordinary turn.
 *
 * @param body - The `prompt` activity body.
 * @param pending - The session's pending choice set.
 * @param base - Conversation, reply target, actor, and identity of the event.
 */
export function decodeSelectReply(
  body: string,
  pending: PendingChoiceSet,
  base: InteractionEventBase,
) {
  const text = body.trim();
  const lowered = text.toLowerCase();
  const choice =
    pending.choices.find((option) => option.optionValue === text) ??
    pending.choices.find(
      (option) => option.label.trim().toLowerCase() === lowered,
    );
  if (choice === undefined) return undefined;

  const hasRawValue =
    typeof choice.value === "string" || typeof choice.value === "number";
  const event: InteractionEvent = {
    ...base,
    id: choice.actionId,
    value: choice.value,
    ...(hasRawValue ? { rawValue: String(choice.value) } : {}),
    messageRef: pending.messageRef,
  };
  return event;
}
