/**
 * Native Slack streaming transport (`chat.startStream` / `appendStream` /
 * `stopStream`, GA Oct 2025) behind the SAME `append(fullText)/finish()`
 * contract as the shipped {@link MessageStream} — callers (the event-renderer's
 * per-message stream, `adapter.stream()`) can't tell which transport ran.
 *
 * Differences from the legacy `chat.update` streamer:
 *
 *   - Slack renders a true streaming UI, and the payload is **raw markdown**
 *     (`markdown_text`), so real tables / fenced code render natively — there
 *     is NO mrkdwn translation and NO bracket auto-closing (Slack's streaming
 *     renderer tolerates a mid-stream-unbalanced buffer).
 *   - `appendStream` takes the *delta* since the last flush, not the full
 *     accumulated text, so this class tracks how much it has already sent.
 *   - A streamed message caps at ~12k characters of markdown; past that we
 *     `stopStream` the current message and `startStream` a continuation,
 *     prepending the open-markdown context (fence / bold / …) so the
 *     continuation stands on its own — the same idea as
 *     {@link ChunkedMessageStream}, reusing `detectOpenContext` /
 *     `renderContextOpener`.
 *
 * Failure handling — "opting in can never break a bot": if the very first
 * `startStream` throws (e.g. a workspace where the streaming API is
 * unavailable), the stream transparently rebuilds itself on the supplied
 * legacy `fallback()` transport and replays the buffer there. `onStartFailure`
 * lets the adapter mark the workspace legacy so subsequent streams skip the
 * native path entirely. Per-`appendStream` failures mid-stream are swallowed
 * (logged) like the legacy streamer's failed edits.
 *
 * Nothing here imports `@slack/web-api` — the Slack calls are injected as a
 * {@link NativeStreamTransport}, keeping the cadence/continuation logic
 * unit-testable with fake timers and a fake transport.
 */
import {
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";

/** A minimal `{ append(fullText), finish() }` streaming sink. */
export interface TextStream {
  /** Replace the in-flight buffer with the accumulated text. */
  append(fullText: string): void;
  /** Flush the final state and close the stream. */
  finish(): Promise<void>;
}

/** The three Slack streaming calls, injected so this file stays SDK-free. */
export interface NativeStreamTransport {
  /** `chat.startStream` → resolves with the new streamed message's `ts`. Throws on failure. */
  startStream(): Promise<string>;
  /** `chat.appendStream` — append a markdown delta to the message at `ts`. */
  appendStream(ts: string, markdownText: string): Promise<void>;
  /** `chat.stopStream` — finalize the streamed message at `ts`. */
  stopStream(ts: string): Promise<void>;
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
  /** Minimum gap between flushes, in ms (defaults to 800, matching MessageStream). */
  minIntervalMs?: number;
  /** Soft per-message markdown budget; past it we start a continuation message. Default 12000. */
  messageBudget?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 800;
/** Slack caps `markdown_text` (per message and per append) at ~12k chars. */
const DEFAULT_MESSAGE_BUDGET = 12000;

export class NativeMessageStream implements TextStream {
  private buffer = "";
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  /** Current streamed message ts (undefined until the first `startStream`). */
  private curTs: string | undefined;
  /** Buffer index where the current message's content begins. */
  private curStart = 0;
  /** Buffer chars already appended to the current message (excludes the opener prefix). */
  private curPosted = 0;
  /** Display length of the open-context opener prepended to a continuation message. */
  private curOpenerLen = 0;
  /** ts of the first streamed message (for the returned MessageRef). */
  private firstTsValue: string | undefined;

  /** Set once `startStream` has failed and we've fallen back to the legacy transport. */
  private legacy: TextStream | undefined;

  private readonly transport: NativeStreamTransport;
  private readonly makeFallback: () => TextStream;
  private readonly onStartFailure: ((err: unknown) => void) | undefined;
  private readonly minIntervalMs: number;
  private readonly messageBudget: number;

  constructor(config: NativeMessageStreamConfig) {
    this.transport = config.transport;
    this.makeFallback = config.fallback;
    this.onStartFailure = config.onStartFailure;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.messageBudget = config.messageBudget ?? DEFAULT_MESSAGE_BUDGET;
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

  async finish(): Promise<void> {
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
        await this.transport.stopStream(this.curTs);
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
    this.queue = this.queue.then(() => this.flushNow());
  }

  private async flushNow(): Promise<void> {
    if (this.legacy) return; // appends are forwarded directly once failed over
    if (this.buffer.length === 0) return; // never start an empty stream

    // Lazy start. On failure, fall back to the legacy transport and replay.
    if (!this.curTs) {
      try {
        this.curTs = await this.transport.startStream();
        this.firstTsValue = this.curTs;
      } catch (err) {
        this.failOverToLegacy(err, "first");
        return;
      }
    }

    try {
      await this.drainToNative();
    } catch (err) {
      // A mid-stream `appendStream` failure shouldn't sink the stream; the next
      // append retries from the latest buffer (curPosted only advances on
      // success). Continuation-start failures are handled inside drainToNative
      // (failover), so anything reaching here is a genuine append failure.
      console.error(
        `[native-stream] appendStream failed (ts=${this.curTs}, posted=${this.curPosted}/${this.buffer.length}):`,
        err,
      );
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }

  /**
   * Switch to the legacy `chat.update` transport and replay the full buffer so
   * no text is lost. Used when either the first or a continuation `startStream`
   * fails — "opting in can never break a bot". The full buffer is replayed (not
   * just the un-posted remainder) because `append()` forwards the accumulated
   * full text once `this.legacy` is set, so the legacy stream must own the whole
   * response; the already-streamed native message(s) stay as-is.
   */
  private failOverToLegacy(
    err: unknown,
    where: "first" | "continuation",
  ): void {
    console.warn(
      `[native-stream] ${where} startStream failed; using legacy transport:`,
      err,
    );
    this.onStartFailure?.(err);
    const legacy = this.makeFallback();
    legacy.append(this.buffer);
    this.legacy = legacy;
  }

  /** Append all un-posted buffer text to the native stream, splitting messages at the budget. */
  private async drainToNative(): Promise<void> {
    // Loop because a single flush may overflow the current message budget and
    // need to open one (or more) continuation messages.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const posTextLen = this.curOpenerLen + this.curPosted; // display chars in current msg
      const available = this.buffer.length - (this.curStart + this.curPosted);
      if (available <= 0) return;

      // Does the rest fit in the current message's budget?
      if (posTextLen + available <= this.messageBudget) {
        await this.appendDelta(
          this.curStart + this.curPosted,
          this.buffer.length,
        );
        return;
      }

      // Overflow: fill the current message up to the budget at a clean boundary,
      // finalize it, then open a continuation that re-opens any open markdown.
      const searchFrom = this.curStart + this.curPosted;
      // `hardEnd` is the budget ceiling for this message; clamp it to always sit
      // past `searchFrom` so a clean boundary can be found and we always make
      // forward progress (a degenerate opener can never stall the loop).
      const hardEnd = Math.max(
        searchFrom + 1,
        this.curStart + (this.messageBudget - this.curOpenerLen),
      );
      const boundary = this.chooseBoundary(searchFrom, hardEnd);
      if (boundary > searchFrom) {
        await this.appendDelta(searchFrom, boundary);
      }
      const ts = this.curTs!;
      try {
        await this.transport.stopStream(ts);
      } catch (err) {
        console.error(
          `[native-stream] stopStream (continuation) failed (ts=${ts}):`,
          err,
        );
      }
      // Open the continuation, prepending the still-open markdown context so it
      // renders standalone (same as ChunkedMessageStream's re-opener path). A
      // continuation-start failure fails over to legacy (replaying the full
      // buffer) exactly like the first start — never dropping the remainder.
      const opener = renderContextOpener(
        detectOpenContext(this.buffer.slice(0, boundary)),
      );
      let nextTs: string;
      try {
        nextTs = await this.transport.startStream();
      } catch (err) {
        this.failOverToLegacy(err, "continuation");
        return;
      }
      this.curTs = nextTs;
      this.curStart = boundary;
      this.curPosted = 0;
      this.curOpenerLen = opener.length;
      if (opener) await this.transport.appendStream(this.curTs, opener);
    }
  }

  /** Append `buffer[from, to)` to the current message, chunked under the 12k per-append cap. */
  private async appendDelta(from: number, to: number): Promise<void> {
    let cursor = from;
    while (cursor < to) {
      const end = Math.min(cursor + DEFAULT_MESSAGE_BUDGET, to);
      const delta = this.buffer.slice(cursor, end);
      await this.transport.appendStream(this.curTs!, delta);
      cursor = end;
    }
    this.curPosted = to - this.curStart;
  }

  /**
   * Pick a split point in `[from, hardEnd]`: prefer the last newline (so a
   * message ends on a line boundary), else the last space, else `hardEnd`.
   * Never returns a point at or before `from` (that would post nothing and
   * loop); falls back to `hardEnd` in that case.
   */
  private chooseBoundary(from: number, hardEnd: number): number {
    const window = this.buffer.slice(from, hardEnd);
    let rel = window.lastIndexOf("\n");
    if (rel < window.length / 4) rel = window.lastIndexOf(" ");
    const boundary = rel > 0 ? from + rel + 1 : hardEnd;
    return boundary > from ? boundary : hardEnd;
  }
}
