// Pure, Bolt-free Slack ingress semantics. Shared by the local Slack adapter's
// Bolt listener AND the Intelligence-side webhook ingress (OSS-362), so the
// platform-specific parsing (mention stripping, stable event-id derivation,
// real-user-message filtering, field extraction) lives in ONE place instead of
// being duplicated. No `@slack/bolt`, no Slack credentials, no network.
//
// What stays per-side (NOT here): response policy (respondTo), credentialed
// thread-ownership reads (store.has), assistant-pane state, and building the
// reply target / egress route. Each side wraps these pure helpers with its own
// policy + transport.

// Matches both the plain `<@U123>` form and Slack's labeled `<@U123|handle>`
// form, so neither leaves a `|handle>` fragment behind after stripping.
const MENTION_RE = /<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g;

/** Strip `<@U…>` / `<@U…|handle>` mention tokens and collapse whitespace. */
export const stripMentions = (text: string): string =>
  text.replace(MENTION_RE, "").replace(/\s+/g, " ").trim();

/**
 * Derive a stable per-delivery id for inbound idempotency. Prefer the Events
 * API envelope `event_id` (stable across Slack's automatic retries), then the
 * message's `client_msg_id`, then a synthesized `${channel}:${ts}`. Returns
 * undefined only when none is available — never fabricate a random id (that
 * would defeat dedup).
 */
export function deriveEventId(
  body: unknown,
  event: { client_msg_id?: string; ts?: string; channel?: string },
  channel: string,
): string | undefined {
  const envelopeEventId = (body as { event_id?: string } | undefined)?.event_id;
  if (envelopeEventId) return envelopeEventId;
  if (event.client_msg_id) return event.client_msg_id;
  if (event.ts) return `${channel}:${event.ts}`;
  return undefined;
}

/** Minimal shape of a plain Slack message we care about, after filtering. */
export interface PlainUserMessage {
  channel: string;
  text: string;
  user?: string;
  thread_ts?: string;
  channel_type?: string;
  files?: unknown[];
  /** Slack's client-generated message id; a per-delivery dedup fallback. */
  client_msg_id?: string;
  /** Message ts; last-resort dedup key as `${channel}:${ts}`. */
  ts?: string;
}

/**
 * Narrow to plain, user-authored, non-bot, non-subtyped messages with text.
 * Rejects subtypes (edits/joins/…) except `file_share`, bot posts, and
 * app-only messages. Anything that fails this is uninteresting to a bot.
 */
export function isPlainUserMessage(
  message: unknown,
  botUserId: string | undefined,
): message is PlainUserMessage {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  // Reject subtyped messages EXCEPT file uploads (`file_share`), which are real
  // user messages carrying a `files` array we want to deliver.
  if (m.subtype && m.subtype !== "file_share") return false;
  // Loop guard: skip the bot's own posts (matched by bot user id).
  if (botUserId && m.user === botUserId) return false;
  // Skip messages with NO user (true bot-only / app-only posts). Messages
  // posted via a USER token (xoxp-) belonging to an app have BOTH `user` and
  // `bot_id` set — those are real user messages and should pass.
  if (m.bot_id && !m.user) return false;
  if (typeof m.channel !== "string") return false;
  if (typeof m.text !== "string") return false;
  return true;
}

/** Platform-neutral ingress event the closed Intelligence side maps to its envelope. */
export type SlackNeutralEvent =
  | {
      kind: "turn";
      /** Which Slack trigger produced this turn. */
      source: "app_mention" | "direct_message" | "thread_reply";
      channel: string;
      /** Thread anchor: present for mentions and thread replies. */
      threadTs?: string;
      /** Inbound message ts (lets a renderer anchor a "thinking…" status on DMs). */
      ts?: string;
      userText: string;
      senderUserId?: string;
      eventId?: string;
      hasFiles: boolean;
    }
  | {
      kind: "command";
      command: string;
      text: string;
      channel: string;
      senderUserId?: string;
      triggerId?: string;
      eventId?: string;
    };

interface RawSlackEventBody {
  command?: string;
  text?: string;
  channel_id?: string;
  user_id?: string;
  trigger_id?: string;
  event_id?: string;
  event?: Record<string, unknown>;
}

const hasFilesOn = (o: unknown): boolean =>
  Array.isArray((o as { files?: unknown[] } | undefined)?.files) &&
  (o as { files: unknown[] }).files.length > 0;

/**
 * Map a raw Slack payload (Events API envelope or slash-command body) to the
 * platform-neutral ingress shape, or `undefined` when it isn't a turn/command
 * worth delivering (bot echo, subtype, empty). The caller applies its own
 * policy/entitlement gating and builds the reply route. First slice covers
 * app_mention, direct/thread messages, and slash commands.
 */
export function normalizeSlackEvent(
  body: RawSlackEventBody,
  botUserId?: string,
): SlackNeutralEvent | undefined {
  // Slash command: a flat form body, no Events API `event`.
  if (body.command) {
    const channel = body.channel_id ?? "";
    return {
      kind: "command",
      command: body.command,
      text: (body.text ?? "").trim(),
      channel,
      senderUserId: body.user_id,
      triggerId: body.trigger_id,
      eventId: body.trigger_id
        ? `${body.command}:${body.user_id}:${body.trigger_id}`
        : undefined,
    };
  }

  const event = body.event;
  if (!event) return undefined;

  if (event.type === "app_mention") {
    const channel = String(event.channel ?? "");
    const userText = stripMentions(String(event.text ?? ""));
    const hasFiles = hasFilesOn(event);
    if (!userText && !hasFiles) return undefined;
    return {
      kind: "turn",
      source: "app_mention",
      channel,
      threadTs: (event.thread_ts as string) ?? (event.ts as string),
      ts: event.ts as string | undefined,
      userText,
      senderUserId: event.user as string | undefined,
      eventId: deriveEventId(
        body,
        event as { client_msg_id?: string; ts?: string },
        channel,
      ),
      hasFiles,
    };
  }

  if (event.type === "message") {
    if (!isPlainUserMessage(event, botUserId)) return undefined;
    const channel = event.channel;
    const text = (event.text ?? "").trim();
    const hasFiles = hasFilesOn(event);
    if (!text && !hasFiles) return undefined;
    const isDM = event.channel_type === "im";
    const eventId = deriveEventId(body, event, channel);
    if (isDM) {
      return {
        kind: "turn",
        source: "direct_message",
        channel,
        ts: event.ts,
        // Strip mention tokens for parity with app_mention/thread_reply — a DM
        // that @-mentions the bot shouldn't leak the raw `<@U…>` into userText.
        userText: stripMentions(text),
        senderUserId: event.user,
        eventId,
        hasFiles,
      };
    }
    if (!event.thread_ts) return undefined; // top-level channel chatter
    // A threaded @-mention is delivered as BOTH an `app_mention` and this
    // `message` event; app_mention handles it, so skip the duplicate here
    // (mirrors the native Slack listener) to avoid a double response. Match
    // both the plain `<@U…>` and labeled `<@U…|handle>` mention forms — same
    // form set as MENTION_RE — so a labeled mention doesn't slip through.
    if (
      botUserId &&
      (text.includes(`<@${botUserId}>`) || text.includes(`<@${botUserId}|`))
    ) {
      return undefined;
    }
    return {
      kind: "turn",
      source: "thread_reply",
      channel,
      threadTs: event.thread_ts,
      userText: stripMentions(text),
      senderUserId: event.user,
      eventId,
      hasFiles,
    };
  }

  return undefined;
}
