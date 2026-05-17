import type { HttpAgent } from "@ag-ui/client";
import type { WebClient } from "@slack/web-api";
import type { ConversationKey, ReplyTarget } from "./types.js";
import { DM_SCOPE } from "./types.js";

/**
 * One ongoing Slack conversation with the bot. Built fresh per turn from
 * Slack's stored history — Slack itself is our durable storage, so the
 * bridge keeps no separate state.
 */
export interface AgentSession {
  threadId: string;
  agent: HttpAgent;
  replyTarget: ReplyTarget;
}

/**
 * Backed entirely by Slack: every turn pulls the current thread (or DM)
 * history via the Web API, translates it into the AG-UI message shape,
 * and hands a fresh HttpAgent to the turn-runner. Bridge restarts are
 * automatically robust because the bridge holds no state to lose.
 *
 * The only in-memory state is a participation cache — a `Set` of thread
 * keys the bot has already replied to. It's a pure performance hint
 * (avoids one Slack API call per thread-reply event in active
 * conversations) and is rebuilt lazily after a restart by the same
 * Slack lookup that already produces the answer.
 */
export class SlackConversationStore {
  private readonly client: WebClient;
  private readonly botUserId: string;
  /** Stable threadIds → conversation keys ("channelId::scope"). */
  private readonly participated = new Set<string>();

  constructor(args: { client: WebClient; botUserId: string }) {
    this.client = args.client;
    this.botUserId = args.botUserId;
  }

  private keyOf(k: ConversationKey): string {
    return `${k.channelId}::${k.scope}`;
  }

  /** Stable AG-UI threadId derived from the Slack conversation. */
  private threadIdFor(k: ConversationKey): string {
    return `slack-${k.channelId}-${k.scope}`;
  }

  /**
   * Does the bot own this thread? "Ownership" means the bot has at least
   * one prior reply in it (which is the natural definition since the bot
   * only ever replies when @-mentioned or in a thread it already owns).
   *
   * Cached in-process; the first call after a restart is one Slack API
   * round-trip, subsequent calls are O(1).
   */
  async has(key: ConversationKey): Promise<boolean> {
    if (this.participated.has(this.keyOf(key))) return true;
    // DM "scope" is a sentinel — no Slack thread to query. We treat the
    // listener-level DM gate as authoritative; DMs always go through.
    if (key.scope === DM_SCOPE) return false;
    try {
      const r = await this.client.conversations.replies({
        channel: key.channelId,
        ts: key.scope,
        limit: 200,
      });
      const messages = (r.messages ?? []) as Array<{ user?: string }>;
      const owned = messages.some((m) => m.user === this.botUserId);
      if (owned) this.participated.add(this.keyOf(key));
      return owned;
    } catch (err) {
      console.warn("[store] has() lookup failed:", err);
      return false;
    }
  }

  /**
   * Build a fresh AgentSession for this conversation by fetching its
   * Slack history and translating it into the AG-UI message shape.
   * `makeAgent` produces the HttpAgent; we set its `messages` to the
   * translated history.
   */
  async getOrCreate(
    key: ConversationKey,
    replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => HttpAgent,
  ): Promise<AgentSession> {
    const threadId = this.threadIdFor(key);
    const agent = makeAgent(threadId);
    const history = await this.fetchHistory(key);
    (agent as unknown as { messages: AgentMessage[] }).messages = history;
    // Eagerly mark as ours so a follow-up arriving before the bot's first
    // reply has settled into Slack still gets matched as "owned".
    this.participated.add(this.keyOf(key));
    return { threadId, agent, replyTarget };
  }

  /**
   * No-op: the next call rebuilds from Slack, so there's nothing to
   * persist. Kept on the API for symmetry with the previous interface
   * (the turn-runner still calls it; we just do nothing).
   */
  save(_key: ConversationKey, _session: AgentSession): void {
    /* intentionally empty */
  }

  /** Fetch Slack history for either a thread or a DM and translate. */
  private async fetchHistory(key: ConversationKey): Promise<AgentMessage[]> {
    try {
      if (key.scope === DM_SCOPE) {
        const r = await this.client.conversations.history({
          channel: key.channelId,
          limit: 100,
        });
        const slackMsgs = ((r.messages ?? []) as RawSlackMsg[]).reverse(); // oldest first
        return this.translate(slackMsgs);
      }
      const r = await this.client.conversations.replies({
        channel: key.channelId,
        ts: key.scope,
        limit: 200,
      });
      return this.translate((r.messages ?? []) as RawSlackMsg[]);
    } catch (err) {
      console.warn("[store] fetchHistory failed:", err);
      return [];
    }
  }

  /**
   * Translate a chronological run of Slack messages to AG-UI messages,
   * folding (a) our bot's chunked replies into a single assistant turn,
   * (b) skipping our `:wrench:` / `:white_check_mark:` status messages
   * and the `_thinking…_` placeholder, and (c) stripping `<@bot>`
   * mention tokens from user text.
   */
  private translate(messages: RawSlackMsg[]): AgentMessage[] {
    const MENTION_RE = /<@[UW][A-Z0-9]+>/g;
    const isStatusOrPlaceholder = (text: string): boolean =>
      text.startsWith(":wrench:") ||
      text.startsWith(":white_check_mark:") ||
      text === "_thinking…_" ||
      text === "_…(continued)_";

    const out: AgentMessage[] = [];
    for (const m of messages) {
      if (m.subtype) continue;
      if (!m.text) continue;
      const isBot = m.user === this.botUserId;
      if (isBot && isStatusOrPlaceholder(m.text)) continue;
      let content = m.text;
      if (!isBot) {
        content = content.replace(MENTION_RE, "").replace(/\s+/g, " ").trim();
      }
      if (!content) continue;
      const role: "user" | "assistant" = isBot ? "assistant" : "user";

      // Fold consecutive same-role messages — our chunked bot replies are
      // one assistant turn in AG-UI's model, just rendered as N Slack
      // messages.
      const tail = out[out.length - 1];
      if (tail && tail.role === role) {
        tail.content = `${tail.content}\n${content}`;
      } else {
        out.push({ id: m.ts ?? "", role, content });
      }
    }
    return out;
  }
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface RawSlackMsg {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
}
