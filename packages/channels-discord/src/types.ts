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
}

/** The conversation key is just the channel id (threads have their own id). */
export function conversationKeyOf(target: ReplyTarget): string {
  return target.channelId;
}
