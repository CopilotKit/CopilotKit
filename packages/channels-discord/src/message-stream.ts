/**
 * Per-Discord-message streaming text state machine.
 *
 * Wraps a single posted Discord message and lets callers feed it the growing
 * text buffer of a streaming reply. Edits are throttled (Discord's edit rate
 * limit is ~5 edits/5s per channel, tighter than Slack's ~1/sec per message)
 * and *serialised* through a per-message promise queue so concurrent updates
 * can't race — a hazard the previous implementation hit, where End-triggered
 * flush of "ALPHA" could be overtaken by an in-flight flush of "AL" and the
 * final state read "AL".
 *
 * Nothing in this file knows about AG-UI events or discord.js — it's a
 * pure Discord-side primitive: "give me text, I'll keep one Discord message
 * in sync with it."
 */
export interface MessageStreamConfig {
  /** Function that actually writes `text` to Discord (e.g. message.edit). */
  update: (text: string) => Promise<void>;
  /** Minimum gap between consecutive flushes, in ms (defaults to 1100). */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 1100;

export class MessageStream {
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
   * After this resolves, the Discord message reflects the final buffer state.
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
    try {
      await this.update(text);
      // Only mark `text` as delivered once the edit actually succeeds. If we
      // marked it before the await and update() threw, the guard above would
      // treat the failed text as posted — and a final failed flush (via
      // finish() with no further appends) would be lost forever. Assigning
      // after success leaves `posted` unchanged on failure so a subsequent
      // flush re-attempts the same buffer.
      this.posted = text;
    } catch (err) {
      // Rate-limit (429) edits are already handled by discord.js with
      // automatic retry (honoring Retry-After). If we still land here the
      // edit genuinely failed — swallow it: a single failed edit shouldn't
      // sink the stream, and future appends retry with the latest buffer.
      console.error("[message-stream] update failed:", err);
    } finally {
      // Set lastFlushedAt *after* the update returns so the throttle
      // measures wall-clock time between completions, not starts.
      this.lastFlushedAt = Date.now();
    }
  }
}
