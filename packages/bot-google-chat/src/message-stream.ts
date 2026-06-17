/**
 * Per-Google-Chat-message streaming text state machine.
 *
 * Wraps a single posted Google Chat message and lets callers feed it the growing
 * text buffer of a streaming reply. Edits are throttled (Google Chat's update
 * rate limit is ~1/sec per message) and *serialised* through a per-message
 * promise queue so concurrent updates can't race — a hazard the previous
 * implementation hit, where End-triggered flush of "ALPHA" could be
 * overtaken by an in-flight flush of "AL" and the final state read "AL".
 *
 * Nothing in this file knows about AG-UI events or Google Chat SDK — it's a
 * pure Google-Chat-side primitive: "give me text, I'll keep one Google Chat message
 * in sync with it."
 */
export interface TextStream {
  append(text: string): void;
  finish(): Promise<void>;
}

export interface MessageStreamConfig {
  /** Function that actually writes `text` to Google Chat (e.g. spaces.messages.update). */
  update: (text: string) => Promise<void>;
  /** Minimum gap between consecutive flushes, in ms (defaults to 1000). */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 1000;

export class MessageStream implements TextStream {
  private buffer = "";
  private posted = "";
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly minIntervalMs: number;
  private readonly update: (text: string) => Promise<void>;

  constructor(config: MessageStreamConfig) {
    this.update = config.update;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** Replace the in-flight buffer (callers pass the accumulated text). */
  append(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.scheduleFlush();
  }

  /**
   * Mark the stream done. Cancels any pending throttled flush, enqueues a
   * final flush, and resolves once the entire queue (including the final
   * flush and anything previously in flight) has drained.
   *
   * After this resolves, the Google Chat message reflects the final buffer state.
   */
  async finish(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.enqueueFlush();
    await this.queue;
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
    if (this.buffer === this.posted) return;
    const text = this.buffer;
    this.posted = text;
    try {
      await this.update(text);
    } catch (err) {
      // Rate-limit (429) edits are already retried by the Google Chat client
      // (honoring Retry-After). If we still land here the edit genuinely
      // failed — swallow it: a single failed edit shouldn't sink the
      // stream, and future appends retry with the latest buffer.
      console.error("[message-stream] update failed:", err);
    } finally {
      // Set lastFlushedAt *after* the update returns so the throttle
      // measures wall-clock time between completions, not starts.
      this.lastFlushedAt = Date.now();
    }
  }
}
