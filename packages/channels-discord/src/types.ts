/** Where a reply goes. Discord addresses channels, threads, and DMs all by channel id. */
export interface ReplyTarget {
  channelId: string;
  /** Present for guild channels/threads; absent for DMs. */
  guildId?: string;
}

/** A normalized inbound turn with immutable provider identity facts. */
export interface IncomingTurn {
  conversationKey: string;
  messageId: string;
  mentioned: boolean;
  replyTarget: ReplyTarget;
  userText: string;
  actor: ProviderActor;
  raw: unknown;
}

/** The conversation key is just the channel id (threads have their own id). */
export function conversationKeyOf(target: ReplyTarget): string {
  return target.channelId;
}
import type { ProviderActor } from "@copilotkit/channels-ui";
