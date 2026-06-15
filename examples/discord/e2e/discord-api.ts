/**
 * Discord REST API helpers used by the E2E harness. All calls go through the
 * Discord REST API directly (no Gateway/WebSocket connection needed for
 * read/write in a test channel). The bot token handles read-side work
 * (channel history, message fetching) and the optional test-user token lets
 * the harness post AS a real user so the bot's own-message guard doesn't
 * swallow the trigger.
 *
 * Keeping discord.js's REST client here (it's already a dep) rather than
 * raw fetch so we get automatic rate-limit handling.
 */
import "dotenv/config";
import { REST, Routes } from "discord.js";

// ── Env ────────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN missing in .env");

/** Optional second-bot / user-bot token to send messages AS a non-bot-user account. */
export const USER_TOKEN: string | undefined = process.env.DISCORD_TEST_USER_TOKEN;

/** The bot's Discord user ID (from the Developer Portal → Bot page). */
export const BOT_USER_ID: string = process.env.DISCORD_BOT_USER_ID ?? "";

/** The application ID (same as DISCORD_APP_ID). */
const APP_ID = process.env.DISCORD_APP_ID ?? "";

// ── REST clients ───────────────────────────────────────────────────────────

/** Bot-token REST client — used for reading history. */
const botRest = new REST({ version: "10" }).setToken(BOT_TOKEN);

/** User-token REST client — used for posting test prompts so the bot's
 *  self-message filter doesn't discard them. Falls back to the bot token
 *  when DISCORD_TEST_USER_TOKEN is absent (bot-to-bot test mode). */
let _userRest: REST | null = null;
function userRest(): REST {
  if (!_userRest) {
    _userRest = new REST({ version: "10" }).setToken(
      USER_TOKEN ?? BOT_TOKEN!,
    );
  }
  return _userRest;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface DiscordMessage {
  id: string;
  /** Snowflake timestamp — use snowflakeToMs() to compare with Date.now(). */
  timestamp: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  /** Message reference (for replies). */
  message_reference?: { message_id?: string; channel_id?: string };
  /** Component rows (for button-bearing messages). */
  components?: Array<DiscordActionRow>;
  embeds?: Array<Record<string, unknown>>;
  /** Interaction data (only on messages that ARE interaction responses). */
  interaction?: { id: string; name: string };
}

export interface DiscordActionRow {
  type: 1; // ACTION_ROW
  components: Array<DiscordComponent>;
}

export interface DiscordComponent {
  type: number; // 2 = BUTTON, etc.
  custom_id?: string;
  label?: string;
  style?: number;
  /** The JSON-encoded value payload the harness reads back for assertions. */
  value?: string;
  disabled?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert a Discord snowflake ID to a Unix timestamp (ms). */
export function snowflakeToMs(id: string): number {
  return Number(BigInt(id) >> 22n) + 1420070400000;
}

// ── Core API calls ─────────────────────────────────────────────────────────

/**
 * Post a plain-text message to a channel as the test-user (or bot if no
 * user token is set). Returns the created message object.
 */
export async function postAsUser(
  channelId: string,
  content: string,
  opts: {
    /** If set, posts as a reply to this message ID (creates a reply thread). */
    replyToMessageId?: string;
    /** If set, uses this token instead of the default user token. */
    token?: string;
  } = {},
): Promise<DiscordMessage> {
  const body: Record<string, unknown> = { content };
  if (opts.replyToMessageId) {
    body.message_reference = { message_id: opts.replyToMessageId };
    // `fail_if_not_exists: false` is more resilient in tests.
    (body.message_reference as Record<string, unknown>)["fail_if_not_exists"] =
      false;
  }

  const rest = opts.token
    ? new REST({ version: "10" }).setToken(opts.token)
    : userRest();

  return rest.post(Routes.channelMessages(channelId), {
    body,
  }) as Promise<DiscordMessage>;
}

/**
 * Fetch recent messages from a channel (newest first, up to `limit`).
 */
export async function channelHistory(
  channelId: string,
  limit = 10,
): Promise<DiscordMessage[]> {
  return botRest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ limit: String(limit) }),
  }) as Promise<DiscordMessage[]>;
}

/**
 * Fetch messages sent AFTER `afterId` (exclusive). Returns newest-first.
 */
export async function messagesSince(
  channelId: string,
  afterId: string,
  limit = 50,
): Promise<DiscordMessage[]> {
  // Discord `after` returns messages in ascending order; we reverse for
  // consistency with channelHistory (newest first).
  const msgs = (await botRest.get(Routes.channelMessages(channelId), {
    query: new URLSearchParams({ after: afterId, limit: String(limit) }),
  })) as DiscordMessage[];
  return msgs.reverse();
}

/**
 * Fetch the full message object by ID (to get latest content after edits).
 */
export async function getMessage(
  channelId: string,
  messageId: string,
): Promise<DiscordMessage> {
  return botRest.get(
    Routes.channelMessage(channelId, messageId),
  ) as Promise<DiscordMessage>;
}

/**
 * Click a button in a Discord Components V2 message. Sends a
 * `MESSAGE_COMPONENT` interaction to the bot's interaction endpoint
 * (https://discord.com/api/v10/interactions). The bot must have an
 * interactions endpoint URL configured, OR the test runner must know the
 * bot process's internal HTTP port — but for most gateway-based bots the
 * only way to fire an interaction is through the Discord API's interaction
 * delivery system.
 *
 * Because Discord does not expose an "inject interaction" REST endpoint (the
 * delivery happens over the Gateway), this function posts a synthetic
 * interaction to the bot's registered interactions endpoint URL directly when
 * `DISCORD_INTERACTIONS_URL` is set. When that var is absent it falls back to
 * checking whether the bot is configured with a gateway receiver and warns
 * appropriately — full click simulation requires the env var.
 *
 * The `nonce` is used to correlate the response in the channel.
 */
export async function clickButton(opts: {
  channelId: string;
  messageId: string;
  customId: string;
  /** Value payload from the button (for the harness to verify). */
  value?: string;
  guildId?: string;
}): Promise<{ sent: boolean; warning?: string }> {
  const interactionsUrl = process.env.DISCORD_INTERACTIONS_URL;
  if (!interactionsUrl) {
    return {
      sent: false,
      warning:
        "DISCORD_INTERACTIONS_URL not set — button-click simulation skipped. " +
        "Set this to the bot's interactions endpoint URL to enable click tests.",
    };
  }

  // Build a synthetic MESSAGE_COMPONENT interaction payload.
  const interactionPayload = {
    type: 3, // MESSAGE_COMPONENT
    id: String(Date.now()), // synthetic interaction id
    application_id: APP_ID,
    token: `e2e-synthetic-${Date.now()}`,
    channel_id: opts.channelId,
    guild_id: opts.guildId,
    message: { id: opts.messageId, channel_id: opts.channelId },
    data: {
      custom_id: opts.customId,
      component_type: 2, // BUTTON
    },
    user: { id: "e2e-test-user", username: "e2e" },
  };

  const res = await fetch(interactionsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(interactionPayload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `clickButton POST to ${interactionsUrl} failed (${res.status}): ${text}`,
    );
  }
  return { sent: true };
}

// ── Sampling primitives ────────────────────────────────────────────────────

/**
 * Watch a channel for the bot's next reply after `afterMessageId`. Polls
 * `messagesSince` every `intervalMs`; calls `onSample` after each poll.
 * Resolves after the reply has settled (no content-length change across 3
 * consecutive samples) or `timeoutMs` elapses.
 */
export async function watchForReply(args: {
  channelId: string;
  afterMessageId: string;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: DiscordMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{
  finalText: string | undefined;
  finalMessage: DiscordMessage | undefined;
}> {
  const start = Date.now();
  let lastMessage: DiscordMessage | undefined;
  let stableSamples = 0;
  let lastLen = -1;

  while (Date.now() - start < args.timeoutMs) {
    const msgs = await messagesSince(args.channelId, args.afterMessageId, 10);
    // Find the first message from the bot that arrived after our trigger.
    const botMsg = msgs.find((m) => m.author.id === BOT_USER_ID || m.author.bot === true);

    // If we found the bot message, re-fetch it by ID to get latest content
    // (Discord edits the same message during streaming via PATCH /messages/:id).
    if (botMsg) {
      try {
        lastMessage = await getMessage(args.channelId, botMsg.id);
      } catch {
        lastMessage = botMsg;
      }
    }

    const text = lastMessage?.content;
    await args.onSample({
      elapsedMs: Date.now() - start,
      text,
      message: lastMessage,
    });

    const len = text?.length ?? 0;
    if (len === lastLen && len > 0) {
      stableSamples++;
      if (stableSamples >= 3) break;
    } else {
      stableSamples = 0;
      lastLen = len;
    }

    await new Promise<void>((r) => setTimeout(r, args.intervalMs));
  }

  return { finalText: lastMessage?.content, finalMessage: lastMessage };
}

/**
 * Wait for a NEW bot reply beyond the first `seenCount` bot messages already
 * in the channel after `afterMessageId`. Used by the follow-up step.
 */
export async function watchForNextReply(args: {
  channelId: string;
  afterMessageId: string;
  seenCount: number;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: DiscordMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{
  finalText: string | undefined;
  finalMessage: DiscordMessage | undefined;
}> {
  const start = Date.now();
  let target: DiscordMessage | undefined;
  let stable = 0;
  let lastLen = -1;

  while (Date.now() - start < args.timeoutMs) {
    const msgs = await messagesSince(args.channelId, args.afterMessageId, 20);
    const botMsgs = msgs.filter(
      (m) => m.author.id === BOT_USER_ID || m.author.bot === true,
    );

    target =
      botMsgs.length > args.seenCount
        ? botMsgs[botMsgs.length - 1]
        : undefined;

    // Re-fetch the target for latest content.
    if (target) {
      try {
        target = await getMessage(args.channelId, target.id);
      } catch {
        // keep old reference
      }
    }

    const text = target?.content;
    await args.onSample({
      elapsedMs: Date.now() - start,
      text,
      message: target,
    });

    const len = text?.length ?? 0;
    if (target && len === lastLen && len > 0) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
      lastLen = len;
    }

    await new Promise<void>((r) => setTimeout(r, args.intervalMs));
  }

  return { finalText: target?.content, finalMessage: target };
}

// ── Bracket-balance check ──────────────────────────────────────────────────

/**
 * Discord uses Markdown (not mrkdwn), so the balance rules are simpler than
 * Slack's: we check for unmatched fenced code blocks (```) and inline
 * backticks. The "just-opened fence" grace used in the Slack harness applies
 * here too — a fence with no real content past its language line is treated as
 * still-streaming and therefore balanced.
 */
export function isBalanced(text: string): boolean {
  if (!text) return true;

  // ── Fenced code blocks ────────────────────────────────────────────────
  const fences = (text.match(/```/g) ?? []).length;
  if (fences % 2 !== 0) {
    const lastFenceIdx = text.lastIndexOf("```");
    const tail = text.slice(lastFenceIdx + 3);
    const nl = tail.indexOf("\n");
    const codeBody = nl >= 0 ? tail.slice(nl + 1) : "";
    if (/\S/.test(codeBody)) return false; // real content past lang line
    // else: just-opened fence — streaming in progress, treat as balanced
  }

  // ── Inline backticks (outside fences) ────────────────────────────────
  const noFence = text.replace(/```[\s\S]*?```/g, "");
  const inline = (noFence.match(/`/g) ?? []).length;
  if (inline % 2 !== 0) {
    const lastBt = noFence.lastIndexOf("`");
    const after = noFence.slice(lastBt + 1);
    if (/\S/.test(after)) return false;
  }

  return true;
}
