import type { StateStore } from "@copilotkit/channels-core";
import type { Mailbox, ThreadHeaders } from "./threading.js";
import { ancestorIds, conversationKeyFor, threadRoot } from "./threading.js";

/** How long thread mappings and history are kept: 30 days. */
export const THREAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How many messages of history the adapter keeps per thread. */
export const HISTORY_LIMIT = 50;

/** How long an inbound email id is remembered for deduplication: 3 days (Resend retries for about 32 hours). */
export const EMAIL_DEDUP_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Where the next reply in a thread goes, and how it threads. */
export interface ResendThreadState {
  /** The person the adapter replies to. */
  to: Mailbox;
  /** Subject of the reply (already `Re: ...`). */
  subject: string;
  /** The Message-ID the reply answers. */
  inReplyTo?: string;
  /** The References header of the reply, root first. */
  references: string[];
}

/** One stored history message. Text only: attachments are not kept. */
export interface ResendHistoryEntry {
  role: "user" | "assistant";
  text: string;
  /** Inbound email id, or the sent email id. */
  id: string;
  ts: number;
}

/**
 * Thread mappings, reply state, and history for the Resend adapter, kept in
 * a `StateStore` (in memory unless the app passes a shared one).
 */
export class ResendThreadStore {
  constructor(readonly state: StateStore) {}

  /**
   * The conversation key for an inbound email. A reply whose `In-Reply-To`
   * or `References` holds a known Message-ID joins that thread. Otherwise
   * the thread root is the first `References` id, else `In-Reply-To`, else
   * the email's own Message-ID.
   */
  async resolveConversation(
    headers: ThreadHeaders,
  ): Promise<string | undefined> {
    for (const id of ancestorIds(headers)) {
      const known = await this.state.kv.get<string>(msgKey(id));
      if (known) return known;
    }
    const root = threadRoot(headers);
    return root ? conversationKeyFor(root) : undefined;
  }

  /** Remember that a Message-ID belongs to a conversation. */
  async rememberMessage(
    messageId: string,
    conversationKey: string,
  ): Promise<void> {
    await this.state.kv.set(
      msgKey(messageId),
      conversationKey,
      THREAD_RETENTION_MS,
    );
  }

  async getThread(
    conversationKey: string,
  ): Promise<ResendThreadState | undefined> {
    return this.state.kv.get<ResendThreadState>(threadKey(conversationKey));
  }

  async setThread(
    conversationKey: string,
    thread: ResendThreadState,
  ): Promise<void> {
    await this.state.kv.set(
      threadKey(conversationKey),
      thread,
      THREAD_RETENTION_MS,
    );
  }

  async appendHistory(
    conversationKey: string,
    entry: ResendHistoryEntry,
  ): Promise<void> {
    await this.state.list.append(historyKey(conversationKey), entry, {
      maxLen: HISTORY_LIMIT,
      ttlMs: THREAD_RETENTION_MS,
    });
  }

  async history(conversationKey: string): Promise<ResendHistoryEntry[]> {
    return this.state.list.range<ResendHistoryEntry>(
      historyKey(conversationKey),
    );
  }

  /** Whether an inbound email was seen before. Read-only. */
  async emailSeen(emailId: string): Promise<boolean> {
    return (await this.state.kv.get<boolean>(emailSeenKey(emailId))) === true;
  }

  /** Claim an inbound email. Returns `false` when another delivery already claimed it. */
  async claimEmail(emailId: string): Promise<boolean> {
    const seen = await this.state.dedup.seen(
      emailKey(emailId),
      EMAIL_DEDUP_TTL_MS,
    );
    if (seen) return false;
    await this.state.kv.set(emailSeenKey(emailId), true, EMAIL_DEDUP_TTL_MS);
    return true;
  }

  /** Use an action-link nonce. Returns `false` when it was used before. */
  async consumeNonce(nonce: string, ttlMs: number): Promise<boolean> {
    return !(await this.state.dedup.seen(
      `resend:link:${nonce}`,
      Math.max(ttlMs, 1),
    ));
  }
}

const msgKey = (messageId: string) => `resend:msg:${messageId}`;
const threadKey = (conversationKey: string) =>
  `resend:thread:${conversationKey}`;
const historyKey = (conversationKey: string) =>
  `resend:history:${conversationKey}`;
const emailKey = (emailId: string) => `resend:email:${emailId}`;
const emailSeenKey = (emailId: string) => `resend:email-seen:${emailId}`;
