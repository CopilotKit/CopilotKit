import { randomUUID } from "node:crypto";
import type { HttpAgent } from "@ag-ui/client";
import type { WebClient } from "@slack/web-api";
import type { ConversationKey, ReplyTarget } from "./types.js";
import { DM_SCOPE } from "./types.js";
import {
  buildFileContentParts,
  type AgentContentPart,
  type FileDeliveryConfig,
  type SlackFileRef,
} from "./download-files.js";

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
  /** Bot token used to download uploaded files from their `url_private`. */
  private readonly botToken: string;
  private readonly filesConfig: FileDeliveryConfig;
  /** Stable threadIds → conversation keys ("channelId::scope"). */
  private readonly participated = new Set<string>();

  constructor(args: {
    client: WebClient;
    botUserId: string;
    botToken: string;
    files?: FileDeliveryConfig;
  }) {
    this.client = args.client;
    this.botUserId = args.botUserId;
    this.botToken = args.botToken;
    this.filesConfig = args.files ?? {};
  }

  private keyOf(k: ConversationKey): string {
    return `${k.channelId}::${k.scope}`;
  }

  /**
   * A *fresh* AG-UI threadId per turn.
   *
   * We deliberately do NOT reuse a stable per-conversation threadId.
   * Slack is our durable history (every turn is rebuilt from it via
   * {@link fetchHistory}), so the LangGraph thread only needs to live for
   * the duration of one turn. Reusing a stable threadId across turns lets
   * the server-side thread accumulate the agent's *internal* messages
   * (tool calls/results that never round-trip through Slack); on the next
   * turn `@ag-ui/langgraph` regenerates state and the now-larger existing
   * thread no longer matches the incoming history, surfacing as a
   * "Message not found" failure. A unique thread per turn sidesteps that
   * entirely. Restart-recovery for interrupts still works because the
   * picker carries its turn's threadId in Slack message metadata (see
   * `recoverFromStaleClick`).
   */
  private newThreadId(k: ConversationKey): string {
    return `slack-${k.channelId}-${k.scope}-${randomUUID()}`;
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
    const threadId = this.newThreadId(key);
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
  private async translate(messages: RawSlackMsg[]): Promise<AgentMessage[]> {
    const MENTION_RE = /<@[UW][A-Z0-9]+>/g;
    const isStatusOrPlaceholder = (text: string): boolean =>
      text.startsWith(":wrench:") ||
      text.startsWith(":white_check_mark:") ||
      text === "_thinking…_" ||
      text === "_…(continued)_";

    const out: AgentMessage[] = [];
    for (const m of messages) {
      if (m.subtype && m.subtype !== "file_share") continue;
      // Bot's own messages: matched by user id, or by bot_id when the API
      // omits `user` (legacy bot integrations). A user-token app message has
      // BOTH user and bot_id — `!m.user` keeps those classified as user.
      const isBot = m.user === this.botUserId || (!!m.bot_id && !m.user);
      const hasFiles = !isBot && Array.isArray(m.files) && m.files.length > 0;
      if (!m.text && !hasFiles) continue;
      if (isBot && isStatusOrPlaceholder(m.text ?? "")) continue;

      let text = m.text ?? "";
      if (!isBot) {
        text = text.replace(MENTION_RE, "").replace(/\s+/g, " ").trim();
      }
      const role: "user" | "assistant" = isBot ? "assistant" : "user";

      // User message with uploaded files → multimodal content (the agent's
      // model reads the images / decoded text). The bridge only delivers;
      // the app decides what to do with the bytes.
      if (hasFiles) {
        const { parts, notes } = await buildFileContentParts(
          m.files as SlackFileRef[],
          this.botToken,
          this.filesConfig,
        );
        const content: AgentContentPart[] = [];
        if (text) content.push({ type: "text", text });
        content.push(...parts);
        if (notes.length > 0) {
          content.push({
            type: "text",
            text: `[attachment notes: ${notes.join("; ")}]`,
          });
        }
        if (content.length === 0) continue; // nothing usable
        out.push({ id: m.ts ?? "", role, content });
        continue;
      }

      if (!text) continue;
      // Fold consecutive same-role *string* messages — our chunked bot
      // replies are one assistant turn, just rendered as N Slack messages.
      const tail = out[out.length - 1];
      if (tail && tail.role === role && typeof tail.content === "string") {
        tail.content = `${tail.content}\n${text}`;
      } else {
        out.push({ id: m.ts ?? "", role, content: text });
      }
    }
    return out;
  }
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  /** String for plain turns; multimodal parts when a user attached files. */
  content: string | AgentContentPart[];
}

interface RawSlackMsg {
  ts?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
  files?: SlackFileRef[];
}
