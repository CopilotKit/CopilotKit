import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { SlackConversationStore } from "./conversation-store.js";
import type { IncomingTurn, ResolvedSlackRespondToOptions } from "./types.js";
import { DEFAULT_SLACK_RESPOND_TO_OPTIONS, DM_SCOPE } from "./types.js";
import {
  stripMentions,
  deriveEventId,
  isPlainUserMessage,
} from "./ingress-normalize.js";

/**
 * Handler the listener calls when a Slack event maps to a usable turn.
 * The listener doesn't know what happens next — it just hands off.
 */
export type TurnHandler = (
  turn: IncomingTurn,
  client: WebClient,
) => Promise<void> | void;

/** A normalized slash-command invocation the listener hands off. */
export interface SlackCommand {
  /** Command name as Slack sent it, including the leading slash (e.g. "/triage"). */
  command: string;
  /** The argument string after the command. */
  text: string;
  conversation: { channelId: string; scope: string };
  replyTarget: { channel: string };
  senderUserId?: string;
  /** Opaque platform trigger for opening a modal (Slack `trigger_id`). */
  triggerId?: string;
  /**
   * Stable per-invocation id for inbound idempotency. Slash commands carry no
   * Events API `event_id`, so this is derived from
   * `${command}:${user_id}:${trigger_id}` — the closest stable-per-click value
   * Slack provides.
   */
  eventId?: string;
}

export type CommandHandler = (
  command: SlackCommand,
  client: WebClient,
) => Promise<void> | void;

export interface ListenerConfig {
  app: App;
  /** Conversation store — used to check whether a thread-reply is "ours". */
  store: SlackConversationStore;
  /** Bot user id, used to filter out our own messages (loop guard). */
  botUserId: string | undefined;
  /** Resolved response-routing policy for Slack ingress. */
  respondTo?: ResolvedSlackRespondToOptions;
  /** Where each accepted turn is dispatched. */
  onTurn: TurnHandler;
  /** Where each slash command is dispatched. */
  onCommand: CommandHandler;
  /**
   * True if `(channel, threadTs)` is an assistant-pane thread (owned by the
   * Assistant middleware). When provided, threaded `message.im` events for
   * those threads are skipped here so each pane message becomes exactly one
   * turn. Absent (or returning false) → messages flow as shipped.
   */
  isAssistantThread?: (channel: string, threadTs: string) => boolean;
}

/**
 * Attach Slack event handlers to a Bolt app. After this returns, the listener
 * is the sole writer of IncomingTurn events — anything downstream sees a
 * stream of cleanly-normalised turns regardless of which Slack event fired.
 *
 * Triggers:
 *   1. @mention in a channel/thread → start or continue a conversation.
 *   2. DM to the bot                → reply flat in the DM.
 *   3. Plain reply in a tracked thread when explicitly configured.
 *
 * Filters out:
 *   - `subtype` events (edits, joins, channel_renames, …)
 *   - bot messages (any `bot_id`, including our own posts)
 *   - top-level channel chatter we weren't @-mentioned in
 *   - the `message.channels` event that arrives alongside every `app_mention`
 *     (we recognise it by the presence of `<@botUserId>` in the text)
 */
export function attachSlackListener(config: ListenerConfig): void {
  const { app, store, onTurn, onCommand } = config;
  const respondTo = config.respondTo ?? DEFAULT_SLACK_RESPOND_TO_OPTIONS;

  // ── Slash commands ──────────────────────────────────────────────────
  // Forward EVERY registered slash command to the engine, which routes it
  // to the matching `bot.onCommand` handler (and ignores unregistered ones).
  // We ack immediately (Slack's 3s deadline) and hand off; the handler does
  // the slow work. Slack only delivers commands declared in the app config,
  // so the `/.*/ ` matcher just catches whatever Slack sends.
  // The command's args aren't posted to the channel, so we synthesise a
  // stable per-(user) scope, letting a user re-run a command and continue
  // the same conversation.
  app.command(/.*/, async ({ command, ack, client }) => {
    await ack();
    await onCommand(
      {
        command: command.command,
        text: (command.text ?? "").trim(),
        conversation: {
          channelId: command.channel_id,
          scope: `slash::${command.user_id}`,
        },
        replyTarget: { channel: command.channel_id },
        senderUserId: command.user_id,
        triggerId: command.trigger_id,
        // Slash commands carry no Events API event_id; trigger_id is the most
        // stable per-invocation value Slack provides.
        eventId: command.trigger_id
          ? `${command.command}:${command.user_id}:${command.trigger_id}`
          : undefined,
      },
      client,
    );
  });

  app.event("app_mention", async ({ event, body, client }) => {
    if (respondTo.appMentions === false) return;

    const threadTs = event.thread_ts ?? event.ts;
    const userText = stripMentions(event.text ?? "");
    const hasFiles =
      Array.isArray((event as { files?: unknown[] }).files) &&
      (event as { files: unknown[] }).files.length > 0;
    // Fire on a mention with an attachment even if the only text is the
    // mention itself (e.g. "@bot" + a CSV). The store reads the file.
    if (!userText && !hasFiles) return;
    await onTurn(
      {
        conversation: { channelId: event.channel, scope: threadTs },
        replyTarget:
          respondTo.appMentions.reply === "thread"
            ? { channel: event.channel, threadTs }
            : { channel: event.channel },
        userText,
        senderUserId: event.user,
        eventId: deriveEventId(
          body,
          event as { client_msg_id?: string; ts?: string },
          event.channel,
        ),
      },
      client,
    );
  });

  app.message(async ({ message, body, client }) => {
    if (!isPlainUserMessage(message, config.botUserId)) return;

    const text = (message.text ?? "").trim();
    const hasFiles = Array.isArray(message.files) && message.files.length > 0;
    // A bare file upload has empty text but is still a real turn.
    if (!text && !hasFiles) return;

    const isDM = message.channel_type === "im";

    // Pane messages are threaded DMs owned by the Assistant middleware — skip
    // them here so each pane message becomes EXACTLY ONE turn. Gated per-THREAD
    // (assistant threads tracked at runtime), never per-config: ordinary
    // threaded DMs in apps without the Agents toggle keep flowing.
    if (
      isDM &&
      message.thread_ts &&
      config.isAssistantThread?.(message.channel, message.thread_ts)
    )
      return;

    if (!respondTo.directMessages) return;

    if (isDM) {
      await onTurn(
        {
          conversation: { channelId: message.channel, scope: DM_SCOPE },
          // Flat DM reply (no threadTs); carry the inbound ts so the renderer
          // can anchor the native "is thinking…" status to a thread.
          replyTarget: { channel: message.channel, statusTs: message.ts },
          userText: text,
          senderUserId: message.user,
          eventId: deriveEventId(body, message, message.channel),
        },
        client,
      );
      return;
    }

    if (!message.thread_ts) return; // top-level channel chatter — ignore

    // app_mention runs separately for these; skip the duplicate.
    if (config.botUserId && text.includes(`<@${config.botUserId}>`)) return;

    if (respondTo.threadReplies === "mentionsOnly") return;

    // Only continue threads we already own. `has` consults Slack itself,
    // so a restarted bridge naturally recognises threads it replied to
    // before the restart.
    if (
      !(await store.has({
        channelId: message.channel,
        scope: message.thread_ts,
      }))
    )
      return;

    await onTurn(
      {
        conversation: { channelId: message.channel, scope: message.thread_ts },
        replyTarget: { channel: message.channel, threadTs: message.thread_ts },
        userText: stripMentions(text),
        senderUserId: message.user,
        eventId: deriveEventId(body, message, message.channel),
      },
      client,
    );
  });
}
