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

/**
 * Where a reply to an @mention goes. Mirrors `SlackMentionReplyMode`.
 *
 * "thread" opens a Discord thread on the mentioned message and answers inside
 * it; "channel" answers in the channel the mention arrived in.
 *
 * Slack and Discord differ in what this costs. On Slack a thread is implicit —
 * posting with `thread_ts` is the whole operation. On Discord a thread is a
 * real object that must be created first, and it becomes its own channel with
 * its own id, which is then the conversation key.
 */
export type DiscordMentionReplyMode = "thread" | "channel";

export interface DiscordAppMentionOptions {
  /**
   * Where an @mention should reply. "thread" keeps channel noise down and is
   * the default, matching Slack; "channel" replies in place.
   */
  reply?: DiscordMentionReplyMode;
}

/** Mirrors `SlackRespondToOptions`, limited to the mention reply mode. */
export interface DiscordRespondToOptions {
  appMentions?: DiscordAppMentionOptions;
}

export interface ResolvedDiscordRespondToOptions {
  appMentions: { reply: DiscordMentionReplyMode };
}

export const DEFAULT_DISCORD_RESPOND_TO_OPTIONS: ResolvedDiscordRespondToOptions =
  {
    appMentions: { reply: "thread" },
  };

export function resolveDiscordRespondToOptions(
  respondTo?: DiscordRespondToOptions,
): ResolvedDiscordRespondToOptions {
  return {
    appMentions: {
      reply:
        respondTo?.appMentions?.reply ??
        DEFAULT_DISCORD_RESPOND_TO_OPTIONS.appMentions.reply,
    },
  };
}

/** The conversation key is just the channel id (threads have their own id). */
export function conversationKeyOf(target: ReplyTarget): string {
  return target.channelId;
}
import type { ProviderActor } from "@copilotkit/channels-ui";
