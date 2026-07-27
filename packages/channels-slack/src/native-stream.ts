/**
 * Native Slack streaming transport (`chat.startStream` / `appendStream` /
 * `stopStream`, GA Oct 2025) behind the SAME `append(fullText)/finish()`
 * contract as the shipped {@link MessageStream} — callers (the event-renderer's
 * reply stream, `adapter.stream()`) can't tell which transport ran.
 *
 * Differences from the legacy `chat.update` streamer:
 *
 *   - Slack renders a true streaming UI, and the payload is **raw markdown**
 *     (`markdown_text`), so real tables / fenced code render natively — there
 *     is NO mrkdwn translation and NO bracket auto-closing (Slack's streaming
 *     renderer tolerates a mid-stream-unbalanced buffer).
 *   - `appendStream` takes the *delta* since the last flush, not the full
 *     accumulated text, so this class tracks how much it has already sent.
 *   - A single streamed message holds the whole reply: Slack documents no
 *     cumulative per-message cap, only a **12k char limit per `markdown_text`
 *     call**, so long replies are sent as successive ≤12k appends to the SAME
 *     message (no multi-message splitting — that was a `chat.update`-era
 *     workaround).
 *   - Beyond text, the stream can carry structured {@link AnyChunk}s
 *     (`task_update` / `plan_update` / `blocks`) via {@link appendChunk}, which
 *     flushes any pending text first so ordering is preserved, and a finalized
 *     message can carry trailing Block Kit (e.g. a feedback row) via the
 *     `finalBlocks` passed to {@link finish}.
 *
 * Failure handling — "opting in can never break a bot": if the very first
 * `startStream` throws (e.g. a workspace where the streaming API is
 * unavailable), the stream transparently rebuilds itself on the supplied
 * legacy `fallback()` transport and replays the buffer there. `onStartFailure`
 * lets the adapter mark the workspace legacy so subsequent streams skip the
 * native path entirely. Per-`appendStream` failures mid-stream are swallowed
 * (logged) like the legacy streamer's failed edits; a failing structured-chunk
 * append additionally fires `onChunkFailure` so the caller can degrade
 * tool-progress to its legacy surface.
 *
 * Nothing here imports `@slack/web-api` — the Slack calls are injected as a
 * {@link NativeStreamTransport}, keeping the cadence logic unit-testable with
 * fake timers and a fake transport.
 */
import type { AnyChunk, KnownBlock } from "@slack/types";

/** A minimal `{ append(fullText), finish() }` streaming sink. */
export interface TextStream {
  /** Replace the in-flight buffer with the accumulated text. */
  append(fullText: string): void;
  /** Flush the final state and close the stream. */
  finish(): Promise<void>;
}

/** The Slack streaming calls, injected so this file stays SDK-free. */
export interface NativeStreamTransport {
  /** `chat.startStream` → resolves with the new streamed message's `ts`. Throws on failure. */
  startStream(): Promise<string>;
  /** `chat.appendStream` — append a raw `markdown_text` delta to the message at `ts`. */
  appendText(ts: string, markdownText: string): Promise<void>;
  /** `chat.appendStream` — append structured {@link AnyChunk}s to the message at `ts`. */
  appendChunks(ts: string, chunks: AnyChunk[]): Promise<void>;
  /** `chat.stopStream` — finalize the streamed message at `ts`, optionally with trailing blocks. */
  stopStream(ts: string, finalBlocks?: KnownBlock[]): Promise<void>;
}

export interface NativeMessageStreamConfig {
  transport: NativeStreamTransport;
  /**
   * Builds the legacy `chat.update` transport, used only if the first
   * `startStream` throws. The accumulated buffer is replayed into it so no
   * text is lost.
   */
  fallback: () => TextStream;
  /** Called once when the first `startStream` fails (adapter marks the workspace legacy). */
  onStartFailure?: (err: unknown) => void;
  /**
   * Called when a structured-chunk append fails or is impossible (the stream
   * has already fallen back to the legacy `chat.update` transport, which has no
   * chunk equivalent). Lets the caller degrade tool-progress to its legacy
   * surface (`:wrench:` rows). Text streaming is unaffected.
   */
  onChunkFailure?: (err: unknown) => void;
  /** Minimum gap between text flushes, in ms (defaults to 600). */
  minIntervalMs?: number;
}

/**
 * Default text-flush floor. `chat.appendStream` is Tier 4 (100+/min), so 600ms
 * (~100/min) keeps comfortable headroom while streaming noticeably more
 * smoothly than the legacy `chat.update` path (~1/sec). The `WebClient` retries
 * 429s honoring `Retry-After`, so this is a soft floor, not a correctness gate.
 */
const DEFAULT_MIN_INTERVAL_MS = 600;
/** Slack caps `markdown_text` at 12k chars per `appendStream` call. */
const APPEND_CHAR_LIMIT = 12000;

export class NativeMessageStream implements TextStream {
  private buffer = "";
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  /** Current streamed message ts (undefined until the first `startStream`). */
  private curTs: string | undefined;
  /** Buffer chars already appended as text to the current message. */
  private curPosted = 0;
  /** ts of the first streamed message (for the returned MessageRef). */
  private firstTsValue: string | undefined;

  /** Set once `startStream` has failed and we've fallen back to the legacy transport. */
  private legacy: TextStream | undefined;
  /** Set once a chunk append has failed/been refused, so we stop trying. */
  private chunksDisabled = false;

  private readonly transport: NativeStreamTransport;
  private readonly makeFallback: () => TextStream;
  private readonly onStartFailure: ((err: unknown) => void) | undefined;
  private readonly onChunkFailure: ((err: unknown) => void) | undefined;
  private readonly minIntervalMs: number;

  constructor(config: NativeMessageStreamConfig) {
    this.transport = config.transport;
    this.makeFallback = config.fallback;
    this.onStartFailure = config.onStartFailure;
    this.onChunkFailure = config.onChunkFailure;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** The first streamed message's ts (or the fallback's), available after finish(). */
  get firstTs(): string | undefined {
    return this.firstTsValue;
  }

  append(fullText: string): void {
    if (this.legacy) {
      this.legacy.append(fullText);
      return;
    }
    if (fullText === this.buffer) return;
    this.buffer = fullText;
    this.scheduleFlush();
  }

  /**
   * Append a structured chunk (`task_update` / `plan_update` / `blocks`) to the
   * streamed message. Flushes any pending text first so the chunk lands AFTER
   * the text emitted so far. No-op (firing `onChunkFailure` once) when the
   * stream has fallen back to legacy or chunks were already refused.
   */
  appendChunk(chunk: AnyChunk): void {
    if (this.legacy || this.chunksDisabled) {
      if (!this.chunksDisabled) {
        this.chunksDisabled = true;
        this.onChunkFailure?.(new Error("native streaming unavailable"));
      }
      return;
    }
    // Drop the throttle gate so the chunk (and the text before it) flush
    // promptly — tool-progress shouldn't wait out the text cadence.
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.queue = this.queue.then(() => this.flushChunk(chunk));
  }

  async finish(finalBlocks?: KnownBlock[]): Promise<void> {
    this.finished = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.enqueueFlush();
    await this.queue;
    if (this.legacy) {
      await this.legacy.finish();
      return;
    }
    // Finalize the streamed message (no-op if we never started one).
    if (this.curTs) {
      try {
        await this.transport.stopStream(this.curTs, finalBlocks);
      } catch (err) {
        console.error("[native-stream] stopStream failed:", err);
      }
    }
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
    this.queue = this.queue.then(() => this.flushText());
  }

  /** Ensure the stream is started; on failure, fall back to legacy and replay. Returns false if failed over. */
  private async ensureStarted(): Promise<boolean> {
    if (this.curTs) return true;
    try {
      this.curTs = await this.transport.startStream();
      this.firstTsValue = this.curTs;
      return true;
    } catch (err) {
      this.failOverToLegacy(err);
      return false;
    }
  }

  /** Append all un-posted buffer text to the current message, chunked under the 12k per-call cap. */
  private async flushText(): Promise<void> {
    if (this.legacy) return; // appends are forwarded directly once failed over
    if (this.curPosted >= this.buffer.length) return; // nothing new
    if (!(await this.ensureStarted())) return;
    try {
      let cursor = this.curPosted;
      while (cursor < this.buffer.length) {
        const end = Math.min(cursor + APPEND_CHAR_LIMIT, this.buffer.length);
        await this.transport.appendText(
          this.curTs!,
          this.buffer.slice(cursor, end),
        );
        cursor = end;
        this.curPosted = cursor;
      }
    } catch (err) {
      // A mid-stream append failure shouldn't sink the stream; the next flush
      // retries from `curPosted` (only advanced on success).
      console.error(
        `[native-stream] appendText failed (ts=${this.curTs}, posted=${this.curPosted}/${this.buffer.length}):`,
        err,
      );
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }

  /** Flush pending text, then append one structured chunk. */
  private async flushChunk(chunk: AnyChunk): Promise<void> {
    if (this.legacy || this.chunksDisabled) return;
    // Start the stream even if no text yet — a tool call can be the first thing
    // the agent emits (`startStream` accepts a content-less open; the chunk is
    // the message's first content).
    if (!(await this.ensureStarted())) {
      this.disableChunks(new Error("startStream failed"));
      return;
    }
    await this.flushTextInline();
    try {
      await this.transport.appendChunks(this.curTs!, [chunk]);
    } catch (err) {
      console.error(
        `[native-stream] appendChunks failed (ts=${this.curTs}):`,
        err,
      );
      this.disableChunks(err);
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }

  /** Append pending text to the current (already-started) message; swallow failures. */
  private async flushTextInline(): Promise<void> {
    if (this.curPosted >= this.buffer.length) return;
    try {
      let cursor = this.curPosted;
      while (cursor < this.buffer.length) {
        const end = Math.min(cursor + APPEND_CHAR_LIMIT, this.buffer.length);
        await this.transport.appendText(
          this.curTs!,
          this.buffer.slice(cursor, end),
        );
        cursor = end;
        this.curPosted = cursor;
      }
    } catch (err) {
      console.error(
        `[native-stream] appendText (pre-chunk) failed (ts=${this.curTs}):`,
        err,
      );
    }
  }

  private disableChunks(err: unknown): void {
    if (this.chunksDisabled) return;
    this.chunksDisabled = true;
    this.onChunkFailure?.(err);
  }

  /**
   * Switch to the legacy `chat.update` transport and replay the full buffer so
   * no text is lost ("opting in can never break a bot"). The full buffer is
   * replayed because `append()` forwards the accumulated full text once
   * `this.legacy` is set, so the legacy stream owns the whole response.
   */
  private failOverToLegacy(err: unknown): void {
    console.warn(
      "[native-stream] startStream failed; using legacy transport:",
      err,
    );
    this.onStartFailure?.(err);
    const legacy = this.makeFallback();
    legacy.append(this.buffer);
    this.legacy = legacy;
  }
}
