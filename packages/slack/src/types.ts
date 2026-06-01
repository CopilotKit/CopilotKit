/**
 * Where to post a reply in Slack. Used by the renderer; constructed by the
 * listener once per turn.
 */
export interface ReplyTarget {
  channel: string;
  /** Thread ts to post into. Omit for flat replies (DMs). */
  threadTs?: string;
}

/**
 * Stable key identifying one ongoing conversation with the bot.
 *
 * - For a channel thread: `{ channelId, scope: <threadTs> }`
 * - For a DM:             `{ channelId, scope: "dm" }`
 *
 * The store uses the pair as a string key; conversations from different
 * channels never collide.
 */
export interface ConversationKey {
  channelId: string;
  scope: string;
}

/** Sentinel scope used for DMs (DMs are flat — no thread). */
export const DM_SCOPE = "dm";

/**
 * What the listener emits per turn. Everything downstream of the listener
 * works in terms of these — they don't know about Slack event shapes.
 */
export interface IncomingTurn {
  conversation: ConversationKey;
  replyTarget: ReplyTarget;
  userText: string;
  /**
   * Slack user id of the person who sent this message (the requester).
   * Surfaced to the agent so it can act on behalf of the right person —
   * e.g. scope "my issues" to them, or assign created work to them.
   * Absent only if the originating event carried no user (rare).
   */
  senderUserId?: string;
}
