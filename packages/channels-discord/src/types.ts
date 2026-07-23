import type { ChannelConversationKind } from "@copilotkit/channels-core";

/** Where a reply goes. Discord addresses channels, threads, and DMs all by channel id. */
export interface ReplyTarget {
  channelId: string;
  /** Present for guild channels/threads; absent for DMs. */
  guildId?: string;
}

/** A normalized inbound turn, before the adapter resolves the sender profile. */
export interface IncomingTurn {
  conversationKey: string;
  replyTarget: ReplyTarget;
  userText: string;
  senderUserId?: string;
  /**
   * Normalized conversation surface kind (plan §2), used by the engine's
   * product-driven response policy to decide whether a shared-channel message
   * is addressed.
   */
  conversationKind?: ChannelConversationKind;
  /** Whether the bot was explicitly @-mentioned in this message (plan §2). */
  mentioned?: boolean;
}

/** The conversation key is just the channel id (threads have their own id). */
export function conversationKeyOf(target: ReplyTarget): string {
  return target.channelId;
}
