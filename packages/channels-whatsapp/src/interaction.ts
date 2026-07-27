import type { InteractionEvent } from "@copilotkit/channels-core";
import type { InboundMessage, ReplyTarget } from "./types.js";

/**
 * Stable conversation key shared by ingress (onTurn) and interaction decoding
 * so `awaitChoice` waiters resolve. Both paths MUST derive the key from this
 * single helper — a mismatch silently strands the waiter.
 */
export function conversationKeyOf(waId: string): string {
  return `whatsapp:${waId}`;
}

/** Inverse of conversationKeyOf: recover the wa_id from a conversation key. */
export function waIdFromKey(conversationKey: string): string {
  return conversationKey.replace(/^whatsapp:/, "");
}

/**
 * Decode an inbound interactive message (`button_reply` / `list_reply`) into a
 * bot `InteractionEvent`. The opaque minted id (`ck:...`) rides in the reply
 * `id`. A control's value is encoded as `${actionId}::${JSON.stringify(value)}`
 * (see render/message.ts), so we split it back here: the engine dispatches by
 * `actionId` and the value rides in `value`.
 */
export function decodeInteraction(
  msg: InboundMessage,
  replyTarget: ReplyTarget,
): InteractionEvent | undefined {
  if (msg.type !== "interactive" || !msg.interactive) return undefined;
  const i = msg.interactive;
  const reply =
    i.type === "button_reply"
      ? i.button_reply
      : i.type === "list_reply"
        ? i.list_reply
        : undefined;
  if (!reply?.id) return undefined;

  let id = reply.id;
  let value: unknown = undefined;
  const sep = reply.id.indexOf("::");
  if (sep !== -1) {
    id = reply.id.slice(0, sep);
    const raw = reply.id.slice(sep + 2);
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }

  return {
    id,
    conversationKey: conversationKeyOf(msg.from),
    replyTarget,
    value,
    user: { id: msg.from },
    messageRef: {
      id: msg.id,
      to: replyTarget.to,
      phoneNumberId: replyTarget.phoneNumberId,
    },
  };
}
