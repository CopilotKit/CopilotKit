import type {
  ChannelConversationKind,
  PlatformUser,
} from "@copilotkit/channels-core";

/**
 * Where to post a reply in Slack. Used by the renderer; constructed by the
 * listener once per turn.
 */
export interface ReplyTarget {
  channel: string;
  /** Thread ts to post into. Omit for flat replies (DMs). */
  threadTs?: string;
  /**
   * Turn sender's Slack user id. `chat.startStream` requires it
   * (`recipient_user_id`) when streaming into a channel; carried here so the
   * native streamer can read it off the target.
   */
  recipientUserId?: string;
  /**
   * Inbound message ts used as the thread anchor for
   * `assistant.threads.setStatus` in flat DMs (which have no `threadTs`).
   * Replies still post flat; this only gives the native "is thinking…"
   * indicator a thread to attach to.
   */
  statusTs?: string;
}

/**
 * Assistant-pane behavior ("Agents & AI Apps"). The pane is ON by default —
 * it activates whenever the Slack app config has the Agents toggle, and lies
 * dormant otherwise. Pass an object to {@link SlackAdapterOptions.assistant} to
 * customize, or `false` to disable pane handling entirely.
 */
export interface SlackAssistantOptions {
  /** Posted when a user opens the pane. */
  greeting?: string;
  /** Up to 4 prompt chips shown on thread start. */
  suggestedPrompts?: ReadonlyArray<{ title: string; message: string }>;
  /** "auto" (default): title the thread from the first user message. false: never title. */
  title?: "auto" | false;
  /** Native status shown under the composer while the agent runs. */
  status?: {
    /** Status while reasoning. Default "is thinking…". */
    thinking?: string;
    /** Up to 10 loading messages Slack rotates through. */
    loadingMessages?: readonly string[];
    /** Surface "is using `tool`…" per tool call. Default true. */
    toolStatus?: boolean;
  };
}

/**
 * A 👍/👎 click on a streamed AI reply's native feedback row (Slack's
 * `feedback_buttons` element, attached at `chat.stopStream`). Delivered to
 * {@link SlackFeedbackOptions.onFeedback}.
 */
export interface SlackFeedback {
  sentiment: "positive" | "negative";
  /** The user who clicked, if Slack supplied their identity. */
  user?: PlatformUser;
  /** Channel (or DM) the reply lives in. */
  channel: string;
  /** Thread the reply belongs to, if any. */
  threadTs?: string;
  /** ts of the streamed reply message the feedback is about. */
  messageTs: string;
}

/**
 * Opt-in native AI feedback buttons. When provided, streamed replies on the
 * native path finalize with a `context_actions` + `feedback_buttons` row, and
 * clicks are routed to {@link onFeedback} (they never reach the engine's
 * interaction dispatch). Omit to show no feedback row.
 */
export interface SlackFeedbackOptions {
  /** Invoked when a user clicks 👍/👎 on a streamed reply. */
  onFeedback: (feedback: SlackFeedback) => void | Promise<void>;
  /** Positive button label. Default "Good response". */
  positiveLabel?: string;
  /** Negative button label. Default "Bad response". */
  negativeLabel?: string;
}

export type SlackMentionReplyMode = "thread" | "channel";

export interface SlackAppMentionOptions {
  /**
   * Where an app mention should reply. "thread" keeps channel noise down and is
   * the default; "channel" posts a top-level channel reply.
   */
  reply?: SlackMentionReplyMode;
}

export interface SlackRespondToOptions {
  /** Respond to normal Slack DMs (`message.im`). Default true. */
  directMessages?: boolean;
  /**
   * Respond to Slack `app_mention` events in channels/private channels. Pass
   * false to ignore app mentions entirely. Default: `{ reply: "thread" }`.
   */
  appMentions?: false | SlackAppMentionOptions;
  // NOTE: the shipped `threadReplies` option ("mentionsOnly" | "afterBotReply")
  // is REMOVED (clean break, beta API — plan §5). Owned-thread auto-continue
  // and the mentions-only gate are superseded by the engine's product-driven
  // response policy (plan §2): every plain, non-mention reply in a shared
  // channel/thread is now forwarded, and the engine requires an explicit tag
  // before auto-running — a prior bot reply does not remove that requirement
  // — unless an `onMessage` handler opts in.
}

export interface ResolvedSlackRespondToOptions {
  directMessages: boolean;
  appMentions: false | { reply: SlackMentionReplyMode };
}

export const DEFAULT_SLACK_RESPOND_TO_OPTIONS: ResolvedSlackRespondToOptions = {
  directMessages: true,
  appMentions: { reply: "thread" },
};

export function resolveSlackRespondToOptions(
  respondTo?: SlackRespondToOptions,
): ResolvedSlackRespondToOptions {
  return {
    directMessages:
      respondTo?.directMessages ??
      DEFAULT_SLACK_RESPOND_TO_OPTIONS.directMessages,
    appMentions:
      respondTo?.appMentions === false
        ? false
        : {
            reply: respondTo?.appMentions?.reply ?? "thread",
          },
  };
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
  /**
   * Stable per-delivery id for inbound idempotency. Prefer the Events API
   * envelope `event_id` (survives Slack's retries), falling back to
   * `client_msg_id` or `${channel}:${ts}`. Undefined when no stable id is
   * available — the engine simply skips dedup for that event (never fabricate
   * a random id; that would defeat dedup).
   */
  eventId?: string;
  /**
   * Normalized conversation surface kind (plan §2). Populated by the listener
   * for EVERY emitted turn so the engine's product-driven response policy
   * (`decideChannelResponse` in channels-core) can decide ignore / run-handler
   * / auto-run. See channels-core's `ChannelConversationKind`.
   */
  conversationKind?: ChannelConversationKind;
  /**
   * True when the bot was explicitly tagged/mentioned in this message.
   * `app_mention` turns are always `true`; every other surface is `false`
   * (DMs and the assistant pane are already directly addressed regardless).
   */
  mentioned?: boolean;
}
