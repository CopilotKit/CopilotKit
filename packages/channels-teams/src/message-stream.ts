/**
 * Per-Teams-message streamed-by-edit state machine.
 *
 * Teams' baseline streaming model (the one the M365 Agents Playground and the
 * Bot Framework connector support without native token streaming) is
 * **post-then-edit**: send one message activity, then `updateActivity` it as the
 * text grows. This wraps a single such message and lets a caller feed it the
 * growing buffer of a streaming reply.
 *
 * Edits are throttled (Teams rate-limits activity updates) and *serialised*
 * through a per-message promise queue so an in-flight edit of "AL" can't be
 * overtaken by a later edit of "ALPHA" and leave the message reading "AL".
 *
 * Nothing here knows about AG-UI or the M365 SDK. It's a pure primitive:
 * "give me text, I'll keep one Teams message in sync with it." The caller
 * supplies `post` (first send, returns the activity id), `update` (subsequent
 * edits), and an optional `typing` hook fired once before the first post.
 */
export interface TeamsMessageStreamConfig {
  /** First send. Returns the posted activity id (used for later edits). */
  post: (text: string) => Promise<string>;
  /** Edit the posted activity to `text`. */
  update: (id: string, text: string) => Promise<void>;
  /** Optional: fire a typing indicator once, before the first post. */
  typing?: () => Promise<void>;
  /** Minimum gap between consecutive flushes, in ms (defaults to 700). */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 700;

export class TeamsMessageStream {
  private buffer = "";
  private posted = "";
  private id: string | undefined;
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly minIntervalMs: number;
  private readonly config: TeamsMessageStreamConfig;

  constructor(config: TeamsMessageStreamConfig) {
    this.config = config;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** Replace the in-flight buffer (callers pass the accumulated text). */
  append(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.scheduleFlush();
  }

  /**
   * Mark the stream done: cancel any pending throttled flush, drain the in-flight
   * queue, then perform the FINAL send fail-loud. The posted activity then
   * reflects the final buffer. Returns the activity id (or `undefined` if nothing
   * was ever posted, e.g. an empty stream).
   *
   * Unlike the throttled mid-stream flushes (which tolerate a dropped edit and
   * retry on the next append), the final send **rejects** if the transport call
   * fails: the buffer was never delivered, so the caller must be able to
   * fail/retry the turn rather than silently mark it "sent".
   */
  async finish(): Promise<string | undefined> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Drain any in-flight throttled flushes first — their failures stay tolerated
    // (a dropped mid-stream edit shouldn't sink the reply). `flushNow` swallows,
    // so the queue never rejects and awaiting it is safe.
    await this.queue;
    // Then send the final buffer fail-loud: a throw here propagates so the
    // consumer never marks the turn delivered when the last send didn't land.
    await this.flushFinal();
    return this.id;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const elapsed = Date.now() - this.lastFlushedAt;
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.enqueueFlush();
    }, delay);
  }

  private enqueueFlush(): void {
    this.queue = this.queue.then(() => this.flushNow());
  }

  /**
   * Send the latest buffer: first send via `post` (capturing the activity id),
   * subsequent sends via `update`. `posted` is advanced only AFTER the transport
   * call succeeds, so a throw leaves it unchanged and the next (or final) flush
   * retries the same buffer. Throws on transport failure — callers decide whether
   * to tolerate (mid-stream) or propagate (final).
   */
  private async doSend(): Promise<void> {
    const text = this.buffer;
    if (text === this.posted) return;
    // Don't post an empty first message; wait for real content.
    if (this.id === undefined && text.trim().length === 0) return;
    if (this.id === undefined) {
      if (this.config.typing) await this.config.typing();
      this.id = await this.config.post(text);
    } else {
      await this.config.update(this.id, text);
    }
    this.posted = text;
  }

  /** Throttled mid-stream flush: tolerate a dropped edit (log + retry later). */
  private async flushNow(): Promise<void> {
    try {
      await this.doSend();
    } catch (err) {
      // A single failed edit shouldn't sink the stream; `doSend` leaves `posted`
      // unchanged on failure, so the next flush retries with the latest buffer.
      console.error("[teams-message-stream] flush failed:", err);
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }

  /** Final flush at {@link finish}: propagate a transport failure fail-loud. */
  private async flushFinal(): Promise<void> {
    try {
      await this.doSend();
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }
}
