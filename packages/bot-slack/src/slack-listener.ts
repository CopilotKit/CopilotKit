import type { App } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { SlackConversationStore } from "./conversation-store.js";
import type { IncomingTurn } from "./types.js";
import { DM_SCOPE } from "./types.js";

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
  /** Where each accepted turn is dispatched. */
  onTurn: TurnHandler;
  /** Where each slash command is dispatched. */
  onCommand: CommandHandler;
}

const MENTION_RE = /<@[UW][A-Z0-9]+>/g;

const stripMentions = (text: string): string =>
  text.replace(MENTION_RE, "").replace(/\s+/g, " ").trim();

/**
 * Attach Slack event handlers to a Bolt app. After this returns, the listener
 * is the sole writer of IncomingTurn events — anything downstream sees a
 * stream of cleanly-normalised turns regardless of which Slack event fired.
 *
 * Triggers:
 *   1. @mention in a channel        →  start (or continue) the thread it lives in.
 *   2. Plain reply in a tracked thread → continue that thread.
 *   3. DM to the bot                →  reply flat in the DM.
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
      },
      client,
    );
  });

  app.event("app_mention", async ({ event, client }) => {
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
        replyTarget: { channel: event.channel, threadTs },
        userText,
        senderUserId: event.user,
      },
      client,
    );
  });

  app.message(async ({ message, client }) => {
    if (!isPlainUserMessage(message, config.botUserId)) return;

    const text = (message.text ?? "").trim();
    const hasFiles = Array.isArray(message.files) && message.files.length > 0;
    // A bare file upload has empty text but is still a real turn.
    if (!text && !hasFiles) return;

    const isDM = message.channel_type === "im";

    if (isDM) {
      await onTurn(
        {
          conversation: { channelId: message.channel, scope: DM_SCOPE },
          replyTarget: { channel: message.channel },
          userText: text,
          senderUserId: message.user,
        },
        client,
      );
      return;
    }

    if (!message.thread_ts) return; // top-level channel chatter — ignore

    // app_mention runs separately for these; skip the duplicate.
    if (config.botUserId && text.includes(`<@${config.botUserId}>`)) return;

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
      },
      client,
    );
  });
}

/** Minimal shape we actually care about, after filtering. */
interface PlainUserMessage {
  channel: string;
  text: string;
  user?: string;
  thread_ts?: string;
  channel_type?: string;
  files?: unknown[];
}

/**
 * Narrows to plain, user-authored, non-bot, non-subtyped messages with text.
 * Anything that fails this check is uninteresting to the bridge.
 *
 * Bolt's `MessageEvent` is a union over a dozen subtypes; we don't want to
 * pull each member name explicitly. A predicate function with a custom
 * narrow type gives us a clean handler body without that ceremony.
 */
function isPlainUserMessage(
  message: unknown,
  botUserId: string | undefined,
): message is PlainUserMessage {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  // Reject subtyped messages EXCEPT file uploads (`file_share`), which are
  // real user messages carrying a `files` array we want to deliver.
  if (m.subtype && m.subtype !== "file_share") return false;
  // Loop guard: skip the bot's own posts (matched by bot user id).
  if (botUserId && m.user === botUserId) return false;
  // Skip messages with NO user (true bot-only / app-only posts). Messages
  // posted via a USER token (xoxp-) belonging to an app have BOTH `user`
  // and `bot_id` set — those are real user messages and should pass.
  if (m.bot_id && !m.user) return false;
  if (typeof m.channel !== "string") return false;
  if (typeof m.text !== "string") return false;
  return true;
}
