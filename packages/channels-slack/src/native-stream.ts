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
   * Soft cap on the UTF-8 bytes one streamed message may hold before rolling
   * over to a continuation. Defaults to {@link DEFAULT_MESSAGE_BYTE_LIMIT}.
   */
  messageByteLimit?: number;
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
 * Soft cap on what a single streamed message may accumulate before we roll over
 * to a continuation — measured in **UTF-8 bytes**, not JS chars.
 *
 * Slack's cumulative per-message limit is undocumented. Production showed
 * `appendStream` rejecting with `msg_too_long` after ~11.6k had been accepted
 * into one message, which puts the real ceiling near 12k — but that reply was
 * English, where chars and UTF-8 bytes are 1:1, so the datapoint cannot tell us
 * which unit Slack counts.
 *
 * Bytes are therefore the safe unit: UTF-8 byte length is always >= char count,
 * so an 11k-*byte* budget stays under a 12k ceiling whichever unit that ceiling
 * is expressed in. A char-based budget does not: under a byte ceiling a CJK
 * reply (3 bytes/char) blows past it at ~4k chars while an 11k-char budget never
 * fires, which reproduces the original silent-truncation bug for every
 * non-Latin-script user. Costs extra messages for non-Latin replies if the real
 * ceiling turns out to be chars; that is the correct side to err on.
 */
const DEFAULT_MESSAGE_BYTE_LIMIT = 11000;
/**
 * Minimum bytes of buffer text a continuation must be able to carry after its
 * re-opener.
 *
 * The re-opener is synthetic text charged against the message's budget, so a
 * pathological context — an unclosed fence whose language line is itself longer
 * than the cap, e.g. a minified-JSON blob emitted straight after ``` — could
 * fill a fresh message with nothing but its own preamble, roll over, and repeat
 * forever, posting unbounded messages without ever advancing `curPosted`. When
 * the opener cannot leave at least this much room, it is dropped: degraded
 * rendering for one continuation beats an infinite loop.
 */
const MIN_MESSAGE_PROGRESS_BYTES = 256;
/** Bounded retries when `finish()` still has undelivered text (see {@link finish}). */
const FINISH_DRAIN_ATTEMPTS = 3;

/** UTF-8 byte length of the code point at `i`, and its UTF-16 width. */
function codePointAt(
  text: string,
  i: number,
): { readonly bytes: number; readonly units: number } {
  const code = text.charCodeAt(i);
  if (code < 0x80) return { bytes: 1, units: 1 };
  if (code < 0x800) return { bytes: 2, units: 1 };
  if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
    const next = text.charCodeAt(i + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, units: 2 };
  }
  return { bytes: 3, units: 1 };
}

/** UTF-8 byte length of `text`. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const cp = codePointAt(text, i);
    bytes += cp.bytes;
    i += cp.units;
  }
  return bytes;
}

/**
 * Largest index `end >= start` such that `text.slice(start, end)` fits in
 * `budgetBytes` UTF-8 bytes and `maxChars` UTF-16 units.
 *
 * Advances whole code points, so a returned boundary can never split a surrogate
 * pair — a lone high surrogate ending one message (with its orphaned low
 * surrogate starting the next) renders as a replacement glyph in Slack, and
 * whitespace-free text reaches the hard-cut path routinely.
 */
function spanWithinBudget(
  text: string,
  start: number,
  budgetBytes: number,
  maxChars: number,
): number {
  const hardEnd = Math.min(text.length, start + maxChars);
  let i = start;
  let bytes = 0;
  while (i < hardEnd) {
    const cp = codePointAt(text, i);
    if (i + cp.units > hardEnd || bytes + cp.bytes > budgetBytes) break;
    bytes += cp.bytes;
    i += cp.units;
  }
  return i;
}

/**
 * Header + delimiter rows to re-emit when a boundary lands inside a markdown
 * table, or `""` when it doesn't.
 *
 * {@link detectOpenContext} models fences, inline code, and emphasis but not
 * tables, and a long generated table is one of the most common ways a reply gets
 * past the cap in the first place. Without this, continuation messages start
 * mid-row and Slack renders literal pipes instead of a table — a visible
 * regression in the very feature (`markdown_text` native tables) that motivated
 * this transport.
 */
function tableHeaderToReopen(postedText: string): string {
  // Tables cannot contain a blank line, so only the current block matters.
  const blockStart = postedText.lastIndexOf("\n\n");
  const block = blockStart === -1 ? postedText : postedText.slice(blockStart + 2);
  const lines = block.split("\n");
  // A boundary keeps its break char, so the block usually ends with an empty
  // line; the row before it is what the continuation follows on from.
  if (lines[lines.length - 1] === "") lines.pop();
  const delimiter = lines.findIndex(
    (line) => line.includes("|") && /^[\s|:-]*-[\s|:-]*$/.test(line),
  );
  // Need a header row above the delimiter, and we must still be in the rows.
  if (delimiter < 1) return "";
  if (!(lines[lines.length - 1] ?? "").includes("|")) return "";
  return `${lines[delimiter - 1]}\n${lines[delimiter]}\n`;
}

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
    // Mirror `autoCloseOpenMarkdown`'s `hasFenceCodeContent` rule: a fence that
    // has only just opened (```lang with no body yet) is not closed, else the
    // boundary emits an empty code block and immediately re-opens it.
    const opener = postedText.lastIndexOf("```");
    const body = opener === -1 ? "" : postedText.slice(opener + 3);
    if (!body.includes("\n")) return "";
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
   * UTF-8 bytes written to the CURRENT message — buffer text plus the synthetic
   * openers/closers a rollover injects. Compared against `messageByteLimit`, so
   * it must count the synthetic text too; `curPosted` must not, since that
   * indexes the buffer (and is in UTF-16 units, not bytes).
   */
  private curMessageBytes = 0;
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
  private readonly messageByteLimit: number;

  constructor(config: NativeMessageStreamConfig) {
    this.transport = config.transport;
    this.makeFallback = config.fallback;
    this.onStartFailure = config.onStartFailure;
    this.onChunkFailure = config.onChunkFailure;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.messageByteLimit =
      config.messageByteLimit ?? DEFAULT_MESSAGE_BYTE_LIMIT;
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
    // A continuation `startStream` can fail transiently, and unlike a mid-stream
    // failure there is no later flush to retry it — without this, the whole
    // undelivered tail is dropped while the first message finalizes cleanly, so
    // the turn looks successful and the platform never replays it.
    for (
      let attempt = 0;
      attempt < FINISH_DRAIN_ATTEMPTS && this.curPosted < this.buffer.length;
      attempt++
    ) {
      this.enqueueFlush();
      await this.queue;
    }
    if (this.curPosted < this.buffer.length) {
      // Last resort: hand the remainder to the legacy transport rather than lose
      // it. Seeded with ONLY the undelivered tail (not the whole buffer, which is
      // what `failOverToLegacy` does for a never-started stream) so the text
      // already streamed natively is not posted twice. `onStartFailure` is
      // deliberately not fired — a transient continuation failure should not mark
      // the whole workspace legacy.
      const tail = this.buffer.slice(this.curPosted);
      console.error(
        `[native-stream] finish: ${tail.length} chars undelivered after ${FINISH_DRAIN_ATTEMPTS} drain attempts; falling back to legacy for the tail`,
      );
      try {
        const legacy = this.makeFallback();
        legacy.append(tail);
        this.curPosted = this.buffer.length;
        await legacy.finish();
      } catch (err) {
        console.error("[native-stream] legacy tail fallback failed:", err);
      }
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
      this.curMessageBytes = 0;
      const posted = this.buffer.slice(0, this.curPosted);
      // Re-open whatever the boundary straddles. `detectOpenContext` covers
      // fences/inline-code/emphasis; tables it does not model, so they are
      // handled separately (and are mutually exclusive with an open fence).
      const opener =
        renderContextOpener(detectOpenContext(posted)) ||
        tableHeaderToReopen(posted);
      // Charge the opener only when it leaves room to actually carry text —
      // see MIN_MESSAGE_PROGRESS_BYTES. Dropping it keeps the loop terminating.
      const openerBytes = utf8Length(opener);
      if (
        opener &&
        openerBytes + MIN_MESSAGE_PROGRESS_BYTES <= this.messageByteLimit
      ) {
        await this.transport.appendText(this.curTs, opener);
        this.curMessageBytes += openerBytes;
      }
      return true;
    }
    try {
      this.curTs = await this.transport.startStream();
      this.firstTsValue = this.curTs;
      this.curMessageBytes = 0;
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
   * Append every un-posted buffer char, honoring BOTH Slack caps: ≤12k chars per
   * `appendStream` call, and ≤`messageByteLimit` UTF-8 bytes accumulated per
   * message. When a message fills and text remains, the boundary is frozen on a
   * line/word break and the reply continues in a fresh message.
   *
   * Errors propagate to the caller; `curPosted` advances only on a successful
   * append, so a retry resumes exactly where this left off rather than
   * re-posting (the failure mode that put five copies of a novella in a channel).
   */
  private async appendPending(): Promise<void> {
    while (this.curPosted < this.buffer.length) {
      if (!(await this.ensureStarted())) return; // failed over to legacy
      const roomBytes = this.messageByteLimit - this.curMessageBytes;
      if (roomBytes <= 0) {
        await this.rollOver();
        continue;
      }
      // How far the byte budget reaches, and how far one call may reach.
      const byteEnd = spanWithinBudget(
        this.buffer,
        this.curPosted,
        roomBytes,
        Number.MAX_SAFE_INTEGER,
      );
      const callEnd = spanWithinBudget(
        this.buffer,
        this.curPosted,
        Number.MAX_SAFE_INTEGER,
        APPEND_CHAR_LIMIT,
      );
      if (byteEnd >= this.buffer.length) {
        // The rest of the reply fits in this message; only the per-call cap applies.
        await this.appendSlice(Math.min(callEnd, this.buffer.length));
        continue;
      }
      if (byteEnd <= this.curPosted) {
        // Not even one code point fits — the message is full.
        await this.rollOver();
        continue;
      }
      if (callEnd < byteEnd) {
        // Per-call-limited, not message-limited: send a full call, keep the message.
        await this.appendSlice(callEnd);
        continue;
      }
      // Message-limited with text remaining: freeze the boundary, then roll over.
      await this.appendSlice(this.breakPoint(this.curPosted, byteEnd));
      await this.rollOver();
    }
  }

  /** Append `buffer[curPosted, end)` to the current message and advance both cursors. */
  private async appendSlice(end: number): Promise<void> {
    const delta = this.buffer.slice(this.curPosted, end);
    if (!delta) return;
    await this.transport.appendText(this.curTs!, delta);
    this.curPosted = end;
    this.curMessageBytes += utf8Length(delta);
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
    // No usable break (whitespace-free text: CJK, emoji runs, base64) — hard cut.
    // `maxEnd` came from `spanWithinBudget`, which advances whole code points, so
    // it is already surrogate-safe.
    if (at < floor) return maxEnd;
    // +1 keeps the break character on the outgoing message, so the continuation
    // starts cleanly at the next line/word. A break character is never half of a
    // surrogate pair, so this boundary is inherently safe.
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
      this.curMessageBytes += utf8Length(closer);
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
