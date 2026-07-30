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
 *   - Slack enforces a 12k char limit per `markdown_text` call AND a
 *     *cumulative* cap on the text a single streamed message can hold. Once a
 *     message is full, `appendStream` rejects every further delta with
 *     `msg_too_long` — permanently, for the rest of the run. So a long reply is
 *     spread over successive messages: {@link rollOver} closes the full one and
 *     opens a continuation, re-opening any markdown construct that straddles
 *     the boundary (the same shape as the legacy {@link ChunkedMessageStream}).
 *     Appends are *deltas* and Slack has no "un-append", so a frozen boundary
 *     can never be reflowed.
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
import {
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";
import type { OpenMarkdownContext } from "./auto-close-streaming.js";

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
  /**
   * Soft cap on the text one streamed message may hold before rolling over to a
   * continuation. Defaults to {@link DEFAULT_MESSAGE_CHAR_LIMIT}.
   */
  messageCharLimit?: number;
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
/**
 * Soft cap on the text a single streamed message may accumulate before we roll
 * over to a continuation message.
 *
 * Slack's *cumulative* per-message limit is undocumented; observed in
 * production, `appendStream` began rejecting with `msg_too_long` after ~11.6k
 * chars had been accepted into one message, which puts the real ceiling at 12k
 * (the same number as the per-call cap). Staying a kilobyte under it leaves room
 * for the auto-close closers appended at a boundary and absorbs any drift in
 * how Slack counts, since crossing the cap is unrecoverable for the whole reply
 * rather than merely truncating one append.
 */
const DEFAULT_MESSAGE_CHAR_LIMIT = 11000;

/**
 * The append-only counterpart to {@link renderContextOpener}: the closers that
 * terminate whatever markdown is still open at a rollover boundary, so the
 * message about to be finalized renders as well-formed markdown instead of
 * ending mid-construct.
 *
 * Deliberately NOT {@link autoCloseOpenMarkdown}: that rewrites the text to
 * insert closers *before* trailing whitespace, which an append-only transport
 * cannot express — `appendStream` sends deltas and Slack offers no way to edit
 * text already streamed. Appending after the trailing whitespace is the closest
 * faithful equivalent.
 */
function renderContextCloser(
  ctx: OpenMarkdownContext,
  postedText: string,
): string {
  // Fences are exclusive: inside one, other markers are opaque code.
  if (ctx.fenceLang !== null) {
    return postedText.endsWith("\n") ? "```" : "\n```";
  }
  let out = "";
  if (ctx.inlineCode) out += "`";
  // Walk the bracket stack innermost-first so the rendered structure stays
  // well-nested. Indexed backwards rather than via `reverse()`/`toReversed()`:
  // the former mutates and lint rewrites it to the latter, which needs a newer
  // `lib` than this package builds against.
  for (let i = ctx.brackets.length - 1; i >= 0; i--) out += ctx.brackets[i];
  return out;
}

export class NativeMessageStream implements TextStream {
  private buffer = "";
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  /** Current streamed message ts (undefined until the first `startStream`). */
  private curTs: string | undefined;
  /** Buffer chars already appended as text, across ALL messages of this reply. */
  private curPosted = 0;
  /**
   * Chars written to the CURRENT message — buffer text plus the synthetic
   * openers/closers a rollover injects. Compared against `messageCharLimit`,
   * so it must count the synthetic text too; `curPosted` must not, since that
   * indexes the buffer.
   */
  private curMessagePosted = 0;
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
  private readonly messageCharLimit: number;

  constructor(config: NativeMessageStreamConfig) {
    this.transport = config.transport;
    this.makeFallback = config.fallback;
    this.onStartFailure = config.onStartFailure;
    this.onChunkFailure = config.onChunkFailure;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.messageCharLimit =
      config.messageCharLimit ?? DEFAULT_MESSAGE_CHAR_LIMIT;
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

  /**
   * Open the message the next append should target — the reply's first message,
   * or a continuation after a {@link rollOver}.
   *
   * A failure on the FIRST message falls back to the legacy transport ("opting
   * in can never break a bot"). A failure on a *continuation* must not: the
   * legacy sink is seeded with the whole accumulated buffer, so failing over
   * mid-reply would re-post every character already streamed. It propagates
   * instead, leaving the boundary intact so the next flush retries the
   * continuation.
   *
   * @returns False only when the stream failed over to legacy.
   */
  private async ensureStarted(): Promise<boolean> {
    if (this.curTs) return true;
    if (this.firstTsValue !== undefined) {
      this.curTs = await this.transport.startStream();
      this.curMessagePosted = 0;
      const opener = renderContextOpener(
        detectOpenContext(this.buffer.slice(0, this.curPosted)),
      );
      if (opener) {
        await this.transport.appendText(this.curTs, opener);
        this.curMessagePosted += opener.length;
      }
      return true;
    }
    try {
      this.curTs = await this.transport.startStream();
      this.firstTsValue = this.curTs;
      this.curMessagePosted = 0;
      return true;
    } catch (err) {
      this.failOverToLegacy(err);
      return false;
    }
  }

  /** Append all un-posted buffer text, rolling over to continuation messages as needed. */
  private async flushText(): Promise<void> {
    if (this.legacy) return; // appends are forwarded directly once failed over
    if (this.curPosted >= this.buffer.length) return; // nothing new
    try {
      await this.appendPending();
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

  /**
   * Append every un-posted buffer char, honoring BOTH Slack caps: ≤12k per
   * `appendStream` call, and ≤`messageCharLimit` accumulated per message. When a
   * message fills and text remains, the boundary is frozen on a line/word break
   * and the reply continues in a fresh message.
   *
   * Errors propagate to the caller; `curPosted` advances only on a successful
   * append, so a retry resumes exactly where this left off rather than
   * re-posting (the failure mode that put five copies of a novella in a channel).
   */
  private async appendPending(): Promise<void> {
    while (this.curPosted < this.buffer.length) {
      if (!(await this.ensureStarted())) return; // failed over to legacy
      const room = this.messageCharLimit - this.curMessagePosted;
      if (room <= 0) {
        await this.rollOver();
        continue;
      }
      const remaining = this.buffer.length - this.curPosted;
      if (remaining <= room) {
        // The rest of the reply fits in this message; only the per-call cap applies.
        await this.appendSlice(
          Math.min(this.curPosted + APPEND_CHAR_LIMIT, this.buffer.length),
        );
        continue;
      }
      if (room <= APPEND_CHAR_LIMIT) {
        // This append fills the message and text remains: freeze the boundary.
        await this.appendSlice(
          this.breakPoint(this.curPosted, this.curPosted + room),
        );
        await this.rollOver();
        continue;
      }
      // Room to spare beyond one call (only reachable with a configured limit
      // above the per-call cap): send a full call and re-evaluate.
      await this.appendSlice(this.curPosted + APPEND_CHAR_LIMIT);
    }
  }

  /** Append `buffer[curPosted, end)` to the current message and advance both cursors. */
  private async appendSlice(end: number): Promise<void> {
    const delta = this.buffer.slice(this.curPosted, end);
    if (!delta) return;
    await this.transport.appendText(this.curTs!, delta);
    this.curPosted = end;
    this.curMessagePosted += delta.length;
  }

  /**
   * Pick where to end a message that has run out of room, preferring the last
   * line break in the available window and falling back to the last space, so a
   * boundary never tears a word in half. A break in the first quarter of the
   * window is rejected as too wasteful — a hard cut costs less than shipping a
   * near-empty message.
   *
   * @returns An index strictly greater than `start` (so callers always progress).
   */
  private breakPoint(start: number, maxEnd: number): number {
    const window = this.buffer.slice(start, maxEnd);
    const floor = window.length / 4;
    let at = window.lastIndexOf("\n");
    if (at < floor) at = Math.max(at, window.lastIndexOf(" "));
    if (at < floor) return maxEnd;
    // +1 keeps the break character on the outgoing message, so the continuation
    // starts cleanly at the next line/word.
    return start + at + 1;
  }

  /**
   * Freeze the current message at the boundary: close any markdown construct
   * left open, finalize it, and clear `curTs` so the next {@link ensureStarted}
   * opens the continuation and re-opens that construct.
   */
  private async rollOver(): Promise<void> {
    const posted = this.buffer.slice(0, this.curPosted);
    const closer = renderContextCloser(detectOpenContext(posted), posted);
    if (closer) {
      await this.transport.appendText(this.curTs!, closer);
      this.curMessagePosted += closer.length;
    }
    try {
      await this.transport.stopStream(this.curTs!);
    } catch (err) {
      // A message left rendering as "still streaming" is cosmetic; dropping the
      // rest of the reply is not. Roll over regardless.
      console.error("[native-stream] stopStream (rollover) failed:", err);
    }
    this.curTs = undefined;
  }

  /**
   * Flush pending text, then append one structured chunk.
   *
   * Everything is guarded: this runs on the shared `queue`, and letting a
   * rejection escape would poison every later flush (including `finish`'s
   * `await this.queue`).
   */
  private async flushChunk(chunk: AnyChunk): Promise<void> {
    if (this.legacy || this.chunksDisabled) return;
    try {
      // Start the stream even if no text yet — a tool call can be the first
      // thing the agent emits (`startStream` accepts a content-less open; the
      // chunk is the message's first content).
      if (!(await this.ensureStarted())) {
        this.disableChunks(new Error("startStream failed"));
        return;
      }
      await this.flushTextInline();
      // A rollover inside the text flush retargets the stream, and a legacy
      // failover removes it entirely; re-check before addressing the chunk.
      if (this.legacy || !this.curTs) {
        this.disableChunks(new Error("native stream unavailable"));
        return;
      }
      await this.transport.appendChunks(this.curTs, [chunk]);
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

  /** Append pending text to the current message (rolling over as needed); swallow failures. */
  private async flushTextInline(): Promise<void> {
    if (this.curPosted >= this.buffer.length) return;
    try {
      await this.appendPending();
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
