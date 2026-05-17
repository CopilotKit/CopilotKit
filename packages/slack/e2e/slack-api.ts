/**
 * Slack API helpers used by the E2E harness. The bot token does
 * read-side work (channel history, thread replies) and the optional
 * USER token (xoxp-) lets us post AS Atai so the bot's loop guard
 * doesn't skip the message — i.e. fully API-driven E2E with no
 * browser dependency on the send path.
 */
import "dotenv/config";

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN missing in .env");

export const USER_TOKEN: string | undefined = process.env.SLACK_USER_TOKEN;
export const BOT_USER_ID = process.env.BOT_USER_ID ?? "U0B45V75NNR";

const ENDPOINT = "https://slack.com/api/";

async function slack(
  method: string,
  params: Record<string, unknown> = {},
  token = BOT_TOKEN,
): Promise<Record<string, unknown> & { ok: boolean }> {
  // Slack's Web API accepts form-encoded bodies on every method.
  // JSON body is rejected by read endpoints like conversations.replies.
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  const res = await fetch(`${ENDPOINT}${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: form.toString(),
  });
  const json = (await res.json()) as Record<string, unknown> & { ok: boolean };
  if (!json.ok) throw new Error(`slack ${method} failed: ${JSON.stringify(json)}`);
  return json;
}

export async function postAsUser(
  channel: string,
  text: string,
  opts: { threadTs?: string } = {},
) {
  if (!USER_TOKEN) {
    throw new Error(
      "SLACK_USER_TOKEN missing — run `pnpm exec tsx e2e/grab-user-token.ts` first",
    );
  }
  // `link_names: 1` makes Slack resolve `@username` (and `@here`/`@channel`)
  // in the post body into real mention tokens — without this, the bot's
  // `app_mention` event doesn't fire for plain-text "@CopilotKit AG-UI Bot".
  const params: Record<string, unknown> = { channel, text, link_names: 1 };
  if (opts.threadTs) params.thread_ts = opts.threadTs;
  return slack("chat.postMessage", params, USER_TOKEN);
}

export async function channelHistory(channel: string, limit = 10) {
  const r = await slack("conversations.history", { channel, limit });
  return r.messages as SlackMessage[];
}

export async function threadReplies(
  channel: string,
  ts: string,
  includeMetadata = false,
) {
  const params: Record<string, string | boolean> = { channel, ts };
  if (includeMetadata) params.include_all_metadata = true;
  const r = await slack("conversations.replies", params);
  return r.messages as SlackMessage[];
}

export interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  blocks?: Array<Record<string, any>>;
  metadata?: { event_type?: string; event_payload?: Record<string, any> };
}

/**
 * Watch a thread for the bot's reply. Polls `conversations.replies` every
 * `intervalMs`; calls `onSample` after each poll so the caller can record
 * mid-stream snapshots. Resolves after `timeoutMs` or when the reply has
 * settled (no length change across two consecutive samples).
 */
export async function watchForReply(args: {
  channel: string;
  parentTs: string;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: SlackMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{ finalText: string | undefined; finalMessage: SlackMessage | undefined }> {
  const start = Date.now();
  let lastMessage: SlackMessage | undefined;
  let stableSamples = 0;
  let lastLen = -1;
  while (Date.now() - start < args.timeoutMs) {
    const replies = await threadReplies(args.channel, args.parentTs);
    // The first bot reply in the thread.
    lastMessage = replies.find((m) => m.user === BOT_USER_ID);
    const text = lastMessage?.text;
    await args.onSample({ elapsedMs: Date.now() - start, text, message: lastMessage });
    const len = text?.length ?? 0;
    if (len === lastLen && len > 0) {
      stableSamples++;
      // After 3 consecutive stable samples, assume the stream has settled.
      if (stableSamples >= 3) break;
    } else {
      stableSamples = 0;
      lastLen = len;
    }
    await new Promise((r) => setTimeout(r, args.intervalMs));
  }
  return { finalText: lastMessage?.text, finalMessage: lastMessage };
}

/**
 * Wait for a NEW bot reply in the thread, beyond the first `seenCount`
 * replies that already exist. Used by the harness's follow-up step so it
 * doesn't keep reporting the first (parent) reply.
 */
export async function watchForNextReply(args: {
  channel: string;
  parentTs: string;
  seenCount: number;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: SlackMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{ finalText: string | undefined; finalMessage: SlackMessage | undefined }> {
  const start = Date.now();
  let target: SlackMessage | undefined;
  let stable = 0;
  let lastLen = -1;
  while (Date.now() - start < args.timeoutMs) {
    const replies = await threadReplies(args.channel, args.parentTs);
    const bot = replies.filter((m) => m.user === BOT_USER_ID);
    target = bot.length > args.seenCount ? bot[bot.length - 1] : undefined;
    const text = target?.text;
    await args.onSample({ elapsedMs: Date.now() - start, text, message: target });
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
  return { finalText: target?.text, finalMessage: target };
}

/**
 * Looser sibling of watchForReply for cases where the reply is in the
 * channel directly (DMs / slash commands) rather than threaded.
 */
export async function watchForChannelReply(args: {
  channel: string;
  sinceTs: string;
  intervalMs: number;
  timeoutMs: number;
  onSample: (sample: {
    elapsedMs: number;
    text: string | undefined;
    message: SlackMessage | undefined;
  }) => Promise<void> | void;
}): Promise<{ finalText: string | undefined; finalMessage: SlackMessage | undefined }> {
  const start = Date.now();
  let lastMessage: SlackMessage | undefined;
  let stable = 0;
  let lastLen = -1;
  while (Date.now() - start < args.timeoutMs) {
    const history = await channelHistory(args.channel, 5);
    lastMessage = history.find(
      (m) => m.user === BOT_USER_ID && Number(m.ts) > Number(args.sinceTs),
    );
    const text = lastMessage?.text;
    await args.onSample({ elapsedMs: Date.now() - start, text, message: lastMessage });
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
  return { finalText: lastMessage?.text, finalMessage: lastMessage };
}

/**
 * Bracket-balance check.
 *
 * Streaming subtlety: when the agent has *just opened* a fence
 * (e.g. ``` ```python ``` with no content yet, or ``` ```python\n ```), the
 * buffer has an odd number of ``` but visually that's fine — Slack
 * renders it as an empty/transient code block, content fills in within
 * a moment, and autoCloseOpenMarkdown intentionally does NOT close
 * because adding ``` would produce a flicker.
 *
 * We treat such "just-opened" markers as balanced. A truly unbalanced
 * fence is one with real content (non-whitespace past the optional
 * language line) but no closer.
 */
export function isBalanced(text: string): boolean {
  if (!text) return true;

  // ── Fences ─────────────────────────────────────────────────────
  const fences = (text.match(/```/g) || []).length;
  if (fences % 2 !== 0) {
    const lastFenceIdx = text.lastIndexOf("```");
    const tail = text.slice(lastFenceIdx + 3);
    const nl = tail.indexOf("\n");
    const codeBody = nl >= 0 ? tail.slice(nl + 1) : "";
    if (/\S/.test(codeBody)) return false; // real content past the lang line
    // else: just-opened fence; treat as balanced
  }

  // ── Inline backticks (outside fences) ──────────────────────────
  const noFence = text.replace(/```[\s\S]*?```/g, "");
  const inline = (noFence.match(/`/g) || []).length;
  if (inline % 2 !== 0) {
    const lastBt = noFence.lastIndexOf("`");
    const after = noFence.slice(lastBt + 1);
    if (/\S/.test(after)) return false; // real content past the open backtick
  }
  return true;
}
