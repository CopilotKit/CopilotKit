/**
 * Telegram Bot API helpers used by the E2E harness.
 *
 * ## Chosen approach: (b) MANUAL-TRIGGER smoke
 *
 * Unlike Slack, the Telegram Bot API does NOT allow impersonating a human
 * user to send messages programmatically. The Bot API only lets a bot send
 * messages AS ITSELF. This creates a bootstrapping problem:
 *
 *   - We cannot "send a message as a test user" purely via the Bot API.
 *   - A bot can call `sendMessage` into a chat, but the CopilotKit bot's
 *     loop guard intentionally ignores messages originating from bots
 *     (including itself) to prevent infinite loops.
 *   - The MTProto (TDLib / Telegram Desktop) approach — driving a REAL user
 *     account programmatically — requires a separate phone-number-verified
 *     account, a registered Telegram API App (api_id + api_hash), a session
 *     file, and far more infra than is practical here.
 *
 * Therefore this harness uses a DOCUMENTED MANUAL-TRIGGER flow:
 *
 *   1. The operator opens the Telegram chat with the bot and sends the test
 *      prompt manually (the exact text logged by the harness before each case).
 *   2. The harness polls `getUpdates` (or `getMessages` via a stored
 *      `offset`) until it sees the bot's reply in that chat, then runs the
 *      expectations against the reply text.
 *
 * ### Path to full automation (approach a)
 *
 * Full automation IS achievable by adding a second lightweight Telegram bot
 * ("sender bot") and a test supergroup:
 *   - Add both the main bot AND the sender bot to a supergroup.
 *   - The sender bot calls `sendMessage` into the group; the main bot's
 *     listener fires on group messages (not from itself), processes them,
 *     and replies back into the group.
 *   - The harness drives the sender bot, polls `getUpdates` on the main
 *     bot token for the group replies, and validates them.
 *
 * Set TELEGRAM_SENDER_BOT_TOKEN in .env to enable automatic sending when a
 * sender bot is available. When it's missing, the harness falls back to the
 * manual-trigger flow and logs a clear prompt for the operator.
 *
 * ### NOTE on coverage
 *
 * The manual-trigger flow DOES NOT reduce assertion coverage — all
 * expectations (finalContains, balancedBrackets, minLength, followUp) are
 * evaluated on the real bot reply. What it reduces is automation: the
 * operator must type (or paste) each prompt. The harness logs the exact text
 * to send and waits up to `maxWaitMs` for a reply before timing out.
 */
import "dotenv/config";

// ── Env ──────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing in .env");

/**
 * The numeric chat ID of the test chat where the bot is a member.
 * For DMs this is the user's numeric Telegram ID (positive integer).
 * For groups/supergroups it is the negative chat ID.
 */
export const TEST_CHAT_ID: string = process.env.TELEGRAM_TEST_CHAT_ID ?? "";

/**
 * Optional second bot token. When set, the harness sends prompts
 * programmatically via this "sender bot" (approach a). When absent,
 * the harness falls back to the manual-trigger flow (approach b).
 */
export const SENDER_BOT_TOKEN: string | undefined =
  process.env.TELEGRAM_SENDER_BOT_TOKEN;

// ── Raw Bot API helper ────────────────────────────────────────────────────────

const TELEGRAM_API = "https://api.telegram.org/bot";

async function tgApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const url = `${TELEGRAM_API}${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok) {
    throw new Error(
      `Telegram ${method} failed: ${json.description ?? JSON.stringify(json)}`,
    );
  }
  return json.result as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    username?: string;
    first_name?: string;
  };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

// ── Sending ───────────────────────────────────────────────────────────────────

/**
 * Send a message into `chatId` using the sender bot token (approach a).
 * Returns the sent message (includes its `message_id`).
 *
 * IMPORTANT: this triggers the main CopilotKit bot only when:
 *   (a) the chat is a group/supergroup with BOTH the sender bot and the main
 *       bot as members, OR
 *   (b) the main bot's listener is configured to also handle messages from
 *       other bots (non-default — requires explicit allow-bot config).
 *
 * In a DM context (TELEGRAM_TEST_CHAT_ID is the operator's personal ID) this
 * call would fail unless the operator's chat id is also the sender bot's
 * user id, which doesn't make sense. Use group chats for automated mode.
 */
export async function sendMessageAsSenderBot(
  chatId: string | number,
  text: string,
  opts: { replyToMessageId?: number } = {},
): Promise<TelegramMessage> {
  if (!SENDER_BOT_TOKEN) {
    throw new Error(
      "TELEGRAM_SENDER_BOT_TOKEN not set — automated send unavailable",
    );
  }
  const params: Record<string, unknown> = { chat_id: chatId, text };
  if (opts.replyToMessageId) params.reply_to_message_id = opts.replyToMessageId;
  return tgApi<TelegramMessage>(SENDER_BOT_TOKEN, "sendMessage", params);
}

// ── Polling helpers ───────────────────────────────────────────────────────────

/**
 * Fetch a page of updates from the main bot since `offset`.
 * Uses long-poll with a short timeout so we don't block indefinitely.
 */
export async function getUpdates(
  offset: number,
  limit = 20,
): Promise<TelegramUpdate[]> {
  return tgApi<TelegramUpdate[]>(BOT_TOKEN!, "getUpdates", {
    offset,
    limit,
    timeout: 5,
    // Include both new messages and edits so we can observe streamed replies.
    // The example bot streams by posting a placeholder and then editing it
    // (chunked-edit mode), so we must subscribe to edited_message to see the
    // final text.
    allowed_updates: ["message", "edited_message"],
  });
}

/**
 * Drain any pending updates from the bot's queue (advances the offset without
 * acting on them). Call this BEFORE sending a test prompt so we know the next
 * update we see is the bot's reply to our case — not a stale message from a
 * previous run.
 *
 * Returns the update_id to use as the "drain fence": poll for updates with
 * `offset > drainFence` after this call.
 */
export async function drainUpdates(): Promise<number> {
  let highestUpdateId = -1;
  // Keep fetching until we get an empty page (queue exhausted).
  for (;;) {
    const updates = await getUpdates(highestUpdateId + 1, 100);
    if (updates.length === 0) break;
    for (const u of updates) {
      if (u.update_id > highestUpdateId) highestUpdateId = u.update_id;
    }
  }
  return highestUpdateId;
}

/**
 * Poll the bot's updates for a message FROM THE BOT in `chatId` after
 * `sinceUpdateId`. Calls `onSample` after each poll so the caller can record
 * mid-stream snapshots.
 *
 * NOTE: The example bot uses chunked-edit streaming — it posts a placeholder
 * message (`_thinking…_`) and then edits it repeatedly as chunks arrive. This
 * function subscribes to both `message` and `edited_message` updates (see
 * `getUpdates`) and tracks the LATEST text for each bot `message_id`, so
 * `finalText` reflects the last edit rather than the initial placeholder.
 *
 * Returns the highest `update_id` consumed (`reachedUpdateId`) so callers can
 * pass it as the baseline for a follow-up `watchForNextReply` call.
 */
export async function watchForReply(args: {
  chatId: string | number;
  sinceUpdateId: number;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: TelegramMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{
  finalText: string | undefined;
  finalMessage: TelegramMessage | undefined;
  reachedUpdateId: number;
}> {
  const start = Date.now();
  let offset = args.sinceUpdateId + 1;
  // Map from message_id → latest known TelegramMessage (tracks edits).
  const botMessageMap = new Map<number, TelegramMessage>();
  let stable = 0;
  let lastLen = -1;
  // Track the highest update_id we have consumed so callers can use it as the
  // next baseline without re-delivering already-confirmed updates.
  let reachedUpdateId = args.sinceUpdateId;

  while (Date.now() - start < args.timeoutMs) {
    const updates = await getUpdates(offset);
    for (const u of updates) {
      if (u.update_id >= offset) offset = u.update_id + 1;
      if (u.update_id > reachedUpdateId) reachedUpdateId = u.update_id;
      // Accept both new messages and edits.
      const msg = u.message ?? u.edited_message;
      if (!msg) continue;
      if (String(msg.chat.id) !== String(args.chatId)) continue;
      // Track the latest text for each bot message_id.
      if (msg.from?.is_bot) {
        botMessageMap.set(msg.message_id, msg);
      }
    }
    // The "last" bot message is the one with the highest message_id.
    let lastMessage: TelegramMessage | undefined;
    for (const msg of botMessageMap.values()) {
      if (!lastMessage || msg.message_id > lastMessage.message_id) {
        lastMessage = msg;
      }
    }
    const text = lastMessage?.text;
    await args.onSample({
      elapsedMs: Date.now() - start,
      text,
      message: lastMessage,
    });
    const len = text?.length ?? 0;
    if (len === lastLen && len > 0) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
      lastLen = len;
    }
    await new Promise((r) => setTimeout(r, args.intervalMs));
  }

  let lastMessage: TelegramMessage | undefined;
  for (const msg of botMessageMap.values()) {
    if (!lastMessage || msg.message_id > lastMessage.message_id) {
      lastMessage = msg;
    }
  }
  return {
    finalText: lastMessage?.text,
    finalMessage: lastMessage,
    reachedUpdateId,
  };
}

/**
 * Watch for a SUBSEQUENT bot reply in the same chat after `seenCount` distinct
 * bot message_ids have already been observed. Used by the follow-up step.
 *
 * Like `watchForReply`, this function tracks both `message` and
 * `edited_message` updates and keeps the latest text per `message_id` so edits
 * (chunked-edit streaming) are reflected in `finalText`.
 *
 * `sinceUpdateId` should be the `reachedUpdateId` returned by the preceding
 * `watchForReply` call — NOT the original drain fence — because `getUpdates`
 * destructively advances the server-side offset and prior updates will not
 * reappear.
 *
 * Returns the highest `update_id` consumed (`reachedUpdateId`).
 */
export async function watchForNextReply(args: {
  chatId: string | number;
  sinceUpdateId: number;
  seenCount: number;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: TelegramMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{
  finalText: string | undefined;
  finalMessage: TelegramMessage | undefined;
  reachedUpdateId: number;
}> {
  const start = Date.now();
  let offset = args.sinceUpdateId + 1;
  // Map from message_id → latest known TelegramMessage (tracks edits).
  const botMessageMap = new Map<number, TelegramMessage>();
  let stable = 0;
  let lastLen = -1;
  let reachedUpdateId = args.sinceUpdateId;

  while (Date.now() - start < args.timeoutMs) {
    const updates = await getUpdates(offset);
    for (const u of updates) {
      if (u.update_id >= offset) offset = u.update_id + 1;
      if (u.update_id > reachedUpdateId) reachedUpdateId = u.update_id;
      // Accept both new messages and edits.
      const msg = u.message ?? u.edited_message;
      if (!msg) continue;
      if (String(msg.chat.id) !== String(args.chatId)) continue;
      if (msg.from?.is_bot) {
        botMessageMap.set(msg.message_id, msg);
      }
    }
    // Collect distinct bot message_ids in insertion order (Map preserves it).
    const distinctMessages = Array.from(botMessageMap.values()).sort(
      (a, b) => a.message_id - b.message_id,
    );
    // Target is the (seenCount+1)-th distinct message, i.e. the first NEW one.
    const target =
      distinctMessages.length > args.seenCount
        ? distinctMessages[args.seenCount]
        : undefined;
    const text = target?.text;
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
    await new Promise((r) => setTimeout(r, args.intervalMs));
  }

  const distinctMessages = Array.from(botMessageMap.values()).sort(
    (a, b) => a.message_id - b.message_id,
  );
  const target =
    distinctMessages.length > args.seenCount
      ? distinctMessages[args.seenCount]
      : undefined;
  return { finalText: target?.text, finalMessage: target, reachedUpdateId };
}

// ── Bracket balance ────────────────────────────────────────────────────────────

/**
 * Check that the text has balanced Markdown code fences and inline backticks.
 *
 * Telegram uses MarkdownV2 / HTML formatting — but the bot's text field in
 * `getUpdates` is the raw text the bot sent, which uses Markdown-style fences
 * (the telegram-html module converts them before sending to Telegram). We
 * assert on the raw text from the bot's perspective (what the LLM produced)
 * before the HTML renderer processes it.
 *
 * Note: The Telegram harness observes edits via `edited_message` updates, so
 * it tracks the latest text of each bot message. The `balancedBrackets` check
 * in `telegram-run.ts` is applied to the final (most recently edited) text.
 */
export function isBalanced(text: string): boolean {
  if (!text) return true;

  // ── Fences ─────────────────────────────────────────────────
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 !== 0) {
    const lastFenceIdx = text.lastIndexOf("```");
    const tail = text.slice(lastFenceIdx + 3);
    const nl = tail.indexOf("\n");
    const codeBody = nl >= 0 ? tail.slice(nl + 1) : "";
    if (/\S/.test(codeBody)) return false;
    // just-opened fence; treat as balanced
  }

  // ── Inline backticks (outside fences) ──────────────────────
  const noFence = text.replace(/```[\s\S]*?```/g, "");
  const inline = (noFence.match(/`/g) || []).length;
  if (inline % 2 !== 0) {
    const lastBt = noFence.lastIndexOf("`");
    const after = noFence.slice(lastBt + 1);
    if (/\S/.test(after)) return false;
  }
  return true;
}
