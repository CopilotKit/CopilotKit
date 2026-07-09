import type { InteractionEvent, IncomingReaction } from "@copilotkit/channels";
import type { PlatformUser } from "@copilotkit/channels-ui";
import { DM_SCOPE } from "./types.js";
import type {
  ConversationKey,
  ReplyTarget,
  TelegramMessageRef,
} from "./types.js";

/**
 * Stable string key shared by ingress (listener) and interaction decoding so
 * the bot's awaitChoice waiters resolve. Both paths MUST derive the
 * conversation key from this single helper — a mismatch silently strands
 * the waiter.
 */
export function conversationKeyOf(key: ConversationKey): string {
  return `tg:${key.chatId}:${key.scope}`;
}

/**
 * Derive a ConversationKey from a Telegram message/chat object.
 *
 * - Private chat → DM_SCOPE
 * - Forum supergroup with message_thread_id → "topic:<thread_id>"
 * - Other group → "user:<senderUserId>"
 *
 * Non-forum groups are keyed by the SENDER's user id (not message ids) so that
 * each user has one ongoing conversation per group: a fresh @mention (which has
 * no reply, hence a unique message_id) continues the same conversation rather
 * than spawning a new one, and a callback_query (whose `message` is the BOT's
 * own message) still resolves to the clicking user's conversation. Pass an
 * explicit `userId` to override `message.from?.id` (callbacks must pass the
 * clicking user's id so the key matches ingress).
 */
export function deriveConversationKey(
  message: {
    message_id: number;
    message_thread_id?: number;
    chat: { id: number | string; type: string; is_forum?: boolean };
    reply_to_message?: { message_id: number };
    from?: { id: number };
  },
  userId?: number,
): ConversationKey {
  const { chat } = message;
  const chatId = String(chat.id);

  if (chat.type === "private") {
    return { chatId, scope: DM_SCOPE };
  }

  // Treat message_thread_id as a forum topic ONLY in forum supergroups. In a
  // regular (non-forum) supergroup Telegram also sets message_thread_id on any
  // REPLY message (it doubles as the reply-thread id), so keying off it there
  // would defeat per-user keying (each reply would spawn a new conversation).
  if (message.message_thread_id !== undefined && message.chat?.is_forum) {
    return { chatId, scope: `topic:${message.message_thread_id}` };
  }

  return { chatId, scope: `user:${userId ?? message.from?.id ?? "unknown"}` };
}

/**
 * Map a Telegram `from` user to a PlatformUser.
 */
export function toPlatformUser(from: {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}): PlatformUser | undefined {
  if (!from) return undefined;
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(" ") || undefined;
  return {
    id: String(from.id),
    name,
    handle: from.username,
  };
}

interface TgReactionType {
  type?: string;
  emoji?: string;
}
interface TgMessageReaction {
  chat?: { id?: number | string; type?: string; is_forum?: boolean };
  message_id?: number;
  message_thread_id?: number;
  user?: { id?: number; username?: string; first_name?: string };
  old_reaction?: TgReactionType[];
  new_reaction?: TgReactionType[];
}

const emojiSet = (list: TgReactionType[] | undefined): Set<string> =>
  new Set(
    (list ?? [])
      .filter((r) => r.type === "emoji" && r.emoji)
      .map((r) => r.emoji!),
  );

/**
 * Decode a Telegram `message_reaction` update into zero or more
 * {@link IncomingReaction} events — one per emoji that was added or removed.
 * Only `type === "emoji"` entries are considered; custom_emoji are ignored.
 */
export function decodeReaction(update: unknown): IncomingReaction[] {
  const mr = (update as { message_reaction?: TgMessageReaction })
    .message_reaction;
  if (!mr?.chat?.id || mr.message_id === undefined) return [];
  const oldSet = emojiSet(mr.old_reaction);
  const newSet = emojiSet(mr.new_reaction);
  const chatId = mr.chat.id;
  const message = {
    chat: mr.chat as { id: number | string; type: string; is_forum?: boolean },
    message_id: mr.message_id,
    message_thread_id: mr.message_thread_id,
  };
  const ck = deriveConversationKey(message, mr.user?.id);
  const conversationKey = conversationKeyOf(ck);
  const replyTarget: ReplyTarget = {
    chatId,
    messageThreadId: mr.chat.is_forum ? mr.message_thread_id : undefined,
    conversationKey,
  };
  const user = mr.user
    ? {
        id: String(mr.user.id),
        name: mr.user.first_name,
        handle: mr.user.username,
      }
    : undefined;
  const base = {
    user,
    conversationKey,
    replyTarget,
    messageId: String(mr.message_id),
    // Update-capable ref (chatId + numeric messageId) so an onReaction handler
    // can edit the reacted message in place via thread.update.
    messageRef: { id: String(mr.message_id), chatId, messageId: mr.message_id },
    raw: update,
  };
  const out: IncomingReaction[] = [];
  for (const e of newSet)
    if (!oldSet.has(e)) out.push({ ...base, rawEmoji: e, added: true });
  for (const e of oldSet)
    if (!newSet.has(e)) out.push({ ...base, rawEmoji: e, added: false });
  return out;
}

/**
 * Decode a Telegram callback_query update (grammY or raw Bot API) into a
 * bot InteractionEvent.
 *
 * Accepts either:
 *   - A grammY update: `{ callback_query: { ... } }`
 *   - A bare callback query object: `{ id, data, from, message }`
 */
export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const obj = raw as Record<string, unknown>;

  // Unwrap grammY update wrapper if present.
  const cq = (obj.callback_query ?? obj) as Record<string, unknown>;
  if (!cq || typeof cq !== "object") return undefined;

  // Must have callback data.
  if (!cq.data || typeof cq.data !== "string") return undefined;

  const message = cq.message as
    | {
        message_id: number;
        message_thread_id?: number;
        chat: { id: number | string; type: string; is_forum?: boolean };
        reply_to_message?: { message_id: number };
      }
    | undefined;

  if (!message) return undefined;

  const from = cq.from as
    | { id: number; first_name?: string; last_name?: string; username?: string }
    | undefined;

  // A callback_query's `message` is the BOT's message, so its `from` is the
  // bot. Derive the key from the CLICKING user's id (cq.from) so non-forum
  // group keys match the ingress key produced by the listener.
  const ck = deriveConversationKey(message, from?.id);
  const conversationKey = conversationKeyOf(ck);

  const replyTarget: ReplyTarget = {
    chatId: message.chat.id,
    // Only attach a forum thread id in forum supergroups. In non-forum chats
    // message_thread_id is the reply-thread id and Telegram rejects sends that
    // attach it ("message thread not found").
    messageThreadId: message.chat?.is_forum
      ? message.message_thread_id
      : undefined,
    conversationKey,
  };

  const messageRef: TelegramMessageRef = {
    id: `${message.chat.id}:${message.message_id}`,
    chatId: message.chat.id,
    messageId: message.message_id,
  };

  const user = from ? toPlatformUser(from) : undefined;

  return {
    id: cq.data as string,
    conversationKey,
    replyTarget,
    messageRef,
    user,
  };
}
