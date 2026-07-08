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
   * Mark the stream done: cancel any pending throttled flush, enqueue a final
   * flush, and resolve once the whole queue has drained. The posted activity
   * then reflects the final buffer. Returns the activity id (or `undefined` if
   * nothing was ever posted, e.g. an empty stream).
   */
  async finish(): Promise<string | undefined> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.enqueueFlush();
    await this.queue;
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

  private async flushNow(): Promise<void> {
    const text = this.buffer;
    if (text === this.posted) return;
    // Don't post an empty first message; wait for real content.
    if (this.id === undefined && text.trim().length === 0) return;
    this.posted = text;
    try {
      if (this.id === undefined) {
        if (this.config.typing) await this.config.typing();
        this.id = await this.config.post(text);
      } else {
        await this.config.update(this.id, text);
      }
    } catch (err) {
      // A single failed edit shouldn't sink the stream; reset `posted` so the
      // next flush retries with the latest buffer.
      this.posted = "";
      console.error("[teams-message-stream] flush failed:", err);
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }
}
