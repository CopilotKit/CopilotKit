import type { AgentContentPart } from "./download-files.js";

export interface StoredMessage {
  role: "user" | "assistant";
  /** Plain text for normal turns; multimodal parts when the user sent media. */
  content: string | AgentContentPart[];
  /** Sortable timestamp (the inbound message ts, or a monotonic counter). */
  ts: string;
  /**
   * Platform message id (WhatsApp `wamid`) when known. Lets a later quote-reply
   * resolve the message it quotes (the webhook sends only the quoted id, not its
   * text). Optional — durable stores may omit it.
   */
  id?: string;
}

/**
 * Pluggable conversation-history persistence. WhatsApp exposes no readable
 * history, so the adapter holds it here and replays it into `agent.messages`
 * each turn. The default is in-memory; swap in a durable backend (Redis,
 * Postgres, …) by implementing this interface.
 */
export interface HistoryStore {
  append(conversationKey: string, message: StoredMessage): Promise<void>;
  read(conversationKey: string): Promise<StoredMessage[]>;
}

export interface InMemoryHistoryStoreOptions {
  /** Keep at most this many messages per conversation (drops oldest). Default 100. */
  maxMessages?: number;
}

export class InMemoryHistoryStore implements HistoryStore {
  private readonly map = new Map<string, StoredMessage[]>();
  private readonly maxMessages: number;

  constructor(opts: InMemoryHistoryStoreOptions = {}) {
    this.maxMessages = opts.maxMessages ?? 100;
  }

  async append(conversationKey: string, message: StoredMessage): Promise<void> {
    const arr = this.map.get(conversationKey) ?? [];
    arr.push(message);
    if (arr.length > this.maxMessages)
      arr.splice(0, arr.length - this.maxMessages);
    this.map.set(conversationKey, arr);
  }

  async read(conversationKey: string): Promise<StoredMessage[]> {
    return [...(this.map.get(conversationKey) ?? [])];
  }
}
