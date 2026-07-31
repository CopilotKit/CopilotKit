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

import type { MessageOperation } from "@copilotkit/channels-ui";

// Matches both the plain `<@U123>` form and Slack's labeled `<@U123|handle>`
// form, so neither leaves a `|handle>` fragment behind after stripping.
const MENTION_RE = /<@[A-Z0-9]+(?:\|[^>]+)?>/g;

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
      source: "app_mention" | "direct_message" | "thread_reply" | "message";
      channel: string;
      /** Thread anchor: present for mentions and thread replies. */
      threadTs?: string;
      /** Inbound message ts (lets a renderer anchor a "thinking…" status on DMs). */
      ts?: string;
      userText: string;
      operation: MessageOperation;
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

export interface SlackSelfIdentity {
  botUserId?: string;
  botId?: string;
  appId?: string;
}

const normalizeSelfIdentity = (
  identity: string | SlackSelfIdentity | undefined,
): SlackSelfIdentity =>
  typeof identity === "string" ? { botUserId: identity } : (identity ?? {});

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
  selfIdentity?: string | SlackSelfIdentity,
): SlackNeutralEvent | undefined {
  const {
    botUserId,
    botId: ownBotId,
    appId: ownAppId,
  } = normalizeSelfIdentity(selfIdentity);
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
      operation: {
        kind: "created",
        logicalMessageId: String(event.ts ?? ""),
        revisionId: String(event.event_ts ?? event.ts ?? ""),
        mentioned: true,
      },
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
    const subtype =
      typeof event.subtype === "string" ? event.subtype : undefined;
    const changed =
      subtype === "message_changed" &&
      event.message &&
      typeof event.message === "object"
        ? (event.message as Record<string, unknown>)
        : undefined;
    const previous =
      (subtype === "message_changed" || subtype === "message_deleted") &&
      event.previous_message &&
      typeof event.previous_message === "object"
        ? (event.previous_message as Record<string, unknown>)
        : undefined;
    const message = changed ?? previous ?? event;
    const channel =
      typeof event.channel === "string" ? event.channel : undefined;
    const logicalMessageId =
      (typeof event.deleted_ts === "string" ? event.deleted_ts : undefined) ??
      (typeof message.ts === "string" ? message.ts : undefined) ??
      (typeof event.ts === "string" ? event.ts : undefined);
    const messageUserId =
      (typeof message.user === "string" ? message.user : undefined) ??
      (typeof event.user === "string" ? event.user : undefined);
    const botId =
      (typeof message.bot_id === "string" ? message.bot_id : undefined) ??
      (typeof event.bot_id === "string" ? event.bot_id : undefined);
    const appId =
      (typeof message.app_id === "string" ? message.app_id : undefined) ??
      (typeof event.app_id === "string" ? event.app_id : undefined);
    const actorId = messageUserId ?? botId ?? appId;
    const edited =
      message.edited && typeof message.edited === "object"
        ? (message.edited as Record<string, unknown>)
        : undefined;
    const revisionId =
      (typeof edited?.ts === "string" ? edited.ts : undefined) ??
      (typeof event.event_ts === "string" ? event.event_ts : undefined) ??
      logicalMessageId;
    if (
      !channel ||
      !logicalMessageId ||
      !revisionId ||
      !actorId ||
      (botUserId !== undefined && messageUserId === botUserId) ||
      (ownBotId !== undefined && botId === ownBotId) ||
      (ownAppId !== undefined && appId === ownAppId)
    ) {
      return undefined;
    }
    const deleted = subtype === "message_deleted";
    const text = deleted ? "" : String(message.text ?? "").trim();
    const hasFiles = hasFilesOn(message);
    if (!deleted && !text && !hasFiles) return undefined;
    const isDM = event.channel_type === "im";
    const eventId = deriveEventId(body, event, channel);
    const mentioned =
      !deleted &&
      !!botUserId &&
      (text.includes(`<@${botUserId}>`) || text.includes(`<@${botUserId}|`));
    const operation = {
      kind:
        subtype === "message_changed"
          ? ("updated" as const)
          : deleted
            ? ("deleted" as const)
            : ("created" as const),
      logicalMessageId,
      revisionId,
      mentioned,
    };
    if (isDM) {
      return {
        kind: "turn",
        source: "direct_message",
        channel,
        threadTs:
          typeof event.thread_ts === "string" ? event.thread_ts : undefined,
        ts: typeof event.ts === "string" ? event.ts : undefined,
        // Strip mention tokens for parity with app_mention/thread_reply — a DM
        // that @-mentions the bot shouldn't leak the raw `<@U…>` into userText.
        userText: stripMentions(text),
        operation,
        senderUserId: actorId,
        eventId,
        hasFiles,
      };
    }
    const threadTs =
      (typeof message.thread_ts === "string" ? message.thread_ts : undefined) ??
      (typeof event.thread_ts === "string" ? event.thread_ts : undefined) ??
      logicalMessageId;
    return {
      kind: "turn",
      source:
        typeof event.thread_ts === "string" ||
        typeof message.thread_ts === "string"
          ? "thread_reply"
          : "message",
      channel,
      threadTs,
      userText: stripMentions(text),
      operation,
      senderUserId: actorId,
      eventId,
      hasFiles,
    };
  }

  return undefined;
}
