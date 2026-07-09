import type { AbstractAgent } from "@ag-ui/client";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { ConversationStore, AgentSession } from "@copilotkit/channels";
import type { ReplyTarget } from "./types.js";
import type { AgentContentPart } from "./download-files.js";

/** Maximum number of messages retained per conversation (oldest dropped). */
const MAX_HISTORY = 200;

/**
 * Telegram conversation store with stable threadIds.
 *
 * Unlike Slack (which rebuilds history from the platform API and mints a fresh
 * threadId per turn), Telegram's Bot API cannot read chat history.  This store
 * therefore:
 *  - assigns each conversation a **stable** threadId (`tg-thread-<key>`) so the
 *    agent's own persistence layer can accumulate state across turns; and
 *  - maintains an in-memory message log (lost on restart, capped at 200 entries)
 *    that callers can use for lightweight within-session context.
 */
export class TelegramConversationStore implements ConversationStore {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly history = new Map<string, ThreadMessage[]>();
  /**
   * Per-conversation queue of user messages awaiting delivery to the agent.
   *
   * The listener enqueues each turn's user message (text, or text + file
   * parts) BEFORE invoking the bot handler that calls `runAgent` →
   * {@link getOrCreate}, which drains the queue into the cached agent. This is
   * how Telegram delivers the user's turn to the agent: unlike Slack, the Bot
   * API cannot read chat history, so `Thread.run()` (which only injects a
   * message when `extra.prompt` is set) would otherwise never see the input.
   */
  private readonly pending = new Map<
    string,
    Array<{ content: string | AgentContentPart[] }>
  >();

  private threadIdFor(conversationKey: string): string {
    return `tg-thread-${conversationKey}`;
  }

  /**
   * Enqueue a user message to be delivered to the agent on the next
   * {@link getOrCreate} for `conversationKey`. Content is either a plain text
   * string or an array of AG-UI content parts (text + media).
   */
  enqueueUserMessage(
    conversationKey: string,
    content: string | AgentContentPart[],
  ): void {
    let list = this.pending.get(conversationKey);
    if (!list) {
      list = [];
      this.pending.set(conversationKey, list);
    }
    list.push({ content });
  }

  /**
   * Return the cached AgentSession for `conversationKey`, or create one.
   *
   * On first call for a key `makeAgent` is invoked exactly once with the
   * stable threadId; subsequent calls return the same cached session without
   * invoking `makeAgent` again.
   */
  async getOrCreate(
    conversationKey: string,
    _replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession> {
    let session = this.sessions.get(conversationKey);
    if (!session) {
      const threadId = this.threadIdFor(conversationKey);
      const agent = makeAgent(threadId);
      session = { agent };
      this.sessions.set(conversationKey, session);
    }

    // Drain any user messages the listener enqueued for this turn into the
    // agent so they actually reach the model. Clears the queue so a later
    // getOrCreate (e.g. a follow-up run) does not re-deliver them.
    const queued = this.pending.get(conversationKey);
    if (queued && queued.length > 0) {
      for (const { content } of queued) {
        session.agent.addMessage({
          id: globalThis.crypto.randomUUID(),
          role: "user",
          content,
        });
      }
      this.pending.delete(conversationKey);
    }

    return session;
  }

  /**
   * Append `msg` to the in-memory history for `conversationKey`.
   * Drops the oldest entry when the list exceeds {@link MAX_HISTORY}.
   */
  recordMessage(conversationKey: string, msg: ThreadMessage): void {
    let list = this.history.get(conversationKey);
    if (!list) {
      list = [];
      this.history.set(conversationKey, list);
    }
    list.push(msg);
    if (list.length > MAX_HISTORY) {
      list.shift();
    }
  }

  /** Return the recorded message history for `conversationKey` (or `[]`). */
  getMessages(conversationKey: string): ThreadMessage[] {
    return this.history.get(conversationKey) ?? [];
  }

  /** Whether a session exists for `conversationKey`. */
  has(conversationKey: string): boolean {
    return this.sessions.has(conversationKey);
  }
}
