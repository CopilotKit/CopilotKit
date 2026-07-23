import type { MessageRef } from "@copilotkit/channels-ui";

/** Sentinel scope used for DMs (DMs are flat — no thread). */
export const DM_SCOPE = "dm";

/**
 * Stable key identifying one ongoing conversation with the bot.
 *
 * - For a group/forum thread: `{ chatId, scope: <threadId> }`
 * - For a DM:                 `{ chatId, scope: "dm" }`
 *
 * The store uses the pair as a string key; conversations from different
 * chats never collide.
 */
export interface ConversationKey {
  chatId: string;
  scope: string;
}

/**
 * Where to post a reply in Telegram. Used by the renderer; constructed by
 * the listener once per turn.
 */
export interface ReplyTarget {
  chatId: number | string;
  /** Forum thread id to post into. Omit for flat replies (DMs). */
  messageThreadId?: number;
  /** Message id to reply to. */
  replyToMessageId?: number;
  /** Whether the chat is a forum supergroup. */
  isForum?: boolean;
  /**
   * The exact conversation key for this turn, stamped at ingress so egress
   * (post/getMessages) keys history identically to the listener — avoids
   * re-deriving (which can't reproduce the group `user:` scope).
   */
  conversationKey?: string;
}

/** A stable reference to one Telegram message. */
export interface TelegramMessageRef extends MessageRef {
  id: string;
  chatId: number | string;
  messageId: number;
}

/** A single button in an inline keyboard. */
export interface TelegramInlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

/** The wire payload sent to the Telegram Bot API. */
export interface TelegramPayload {
  text: string;
  parseMode: "HTML";
  inlineKeyboard?: TelegramInlineButton[][];
  photos?: { url: string; caption?: string }[];
}

/**
 * Options accepted by the Telegram adapter constructor — CREDENTIAL-FREE. The
 * adapter builds nothing from a bot token; it only renders and decides. Every
 * credential/transport concern (`token`/`mode`/`webhook`) now lives on
 * {@link GrammyTelegramConnectorOptions} instead — a runner constructs that
 * connector and injects it via `TelegramAdapter.ɵbindConnector` before
 * `start()`/any egress call. Running the adapter unbound throws — that's the
 * intended "you need a custom ChannelRunner" signpost for running Channels
 * without CopilotKit Intelligence.
 */
export interface TelegramAdapterOptions {
  /** AG-UI event names that should interrupt the running agent. */
  interruptEventNames?: ReadonlySet<string>;
  /** Surface "using <tool>…" status messages while the agent runs. */
  showToolStatus?: boolean;
  /** Posted when a user starts a conversation. */
  greeting?: string;
  /** Prompt chips shown at conversation start. */
  suggestedPrompts?: { title: string; message: string }[];
}
