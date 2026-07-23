/**
 * Per-Telegram-message streaming text state machine.
 *
 * Mirrors the Slack MessageStream + ChunkedMessageStream pattern but uses
 * numeric Telegram message IDs instead of Slack `ts` strings.
 *
 * ChunkedEditStream owns N underlying EditStream instances (one per Telegram
 * message). It accepts the full accumulated text on `append()`, decides where
 * the chunk boundaries are (frozen once a message has been posted — no reflow),
 * mints new Telegram messages via `postPlaceholder` as needed, and dispatches
 * the right slice to each chunk's stream.
 *
 * `transform` (e.g. telegramHtml) is applied just before every `editAt` call.
 */

import { TELEGRAM_LIMITS } from "./render/budget.js";

export interface ChunkedEditStreamConfig {
  /**
   * Soft per-message raw char limit. Defaults to Math.floor(TELEGRAM_LIMITS.messageText / 2).
   * The headroom below the 4096 hard cap exists because `transform` (telegramHtml) can
   * expand raw chars significantly: `&`→`&amp;` (5×), `<`/`>`→`&lt;`/`&gt;` (4×),
   * bold/link markdown → HTML tags. Halving the limit is a risk-reduction heuristic that
   * keeps the HTML-transformed slice under 4096 for typical prose/markdown content (which
   * expands modestly); it is NOT a hard guarantee against adversarial all-entity input
   * (e.g. 2048 raw `&` chars → ~10 240 transformed chars).
   */
  limit?: number;
  /** Throttle floor (ms) between consecutive edits per message. Defaults to 1000. */
  minIntervalMs?: number;
  /** Posts a new Telegram message with placeholder text; resolves with the message id. */
  postPlaceholder: (text: string) => Promise<number>;
  /** Edits the Telegram message with the given id to contain `text`. */
  editAt: (messageId: number, text: string) => Promise<void>;
  /**
   * Optional transformer applied to each chunk's text before `editAt` /
   * `postPlaceholder` — e.g. telegramHtml markdown→HTML conversion.
   */
  transform?: (text: string) => string;
}

/**
 * Default raw-char limit per chunk. Set to half of Telegram's 4096 hard cap as a
 * generous headroom heuristic: typical prose/markdown content expands modestly under
 * telegramHtml, so this keeps the rendered output well under 4096 in practice.
 * It is NOT a hard guarantee — adversarial all-entity input can still exceed the cap.
 */
const DEFAULT_LIMIT = Math.floor(TELEGRAM_LIMITS.messageText / 2); // 2048
const DEFAULT_MIN_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Internal single-message stream (mirrors Slack's MessageStream)
// ---------------------------------------------------------------------------

interface EditStreamConfig {
  update: (text: string) => Promise<void>;
  minIntervalMs: number;
}

class EditStream {
  private buffer = "";
  private posted = "";
  private queue: Promise<void> = Promise.resolve();
  private lastFlushedAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly minIntervalMs: number;
  private readonly update: (text: string) => Promise<void>;
  /** Non-null when the terminal flush (from finish()) failed. */
  private terminalError: unknown = undefined;

  constructor(config: EditStreamConfig) {
    this.update = config.update;
    this.minIntervalMs = config.minIntervalMs;
  }

  append(text: string): void {
    if (text === this.buffer) return;
    this.buffer = text;
    this.scheduleFlush();
  }

  async finish(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.enqueueFlush(/* terminal */ true);
    await this.queue;
    if (this.terminalError !== undefined) {
      throw this.terminalError;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const elapsed = Date.now() - this.lastFlushedAt;
    const delay = Math.max(0, this.minIntervalMs - elapsed);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.enqueueFlush(false);
    }, delay);
  }

  private enqueueFlush(terminal: boolean): void {
    this.queue = this.queue.then(() => this.flushNow(terminal));
  }

  private async flushNow(terminal: boolean): Promise<void> {
    if (this.buffer === this.posted) return;
    const text = this.buffer;
    try {
      await this.update(text);
      // Only advance posted after a successful edit so a transient failure
      // leaves the text eligible for retry on the next flush.
      this.posted = text;
    } catch (err) {
      if (terminal) {
        // Surface terminal-flush failures to finish() so the caller can react.
        this.terminalError = err;
      } else {
        // Intermediate flush: log but leave posted unchanged so the next
        // flush will re-attempt the current buffer.
        console.error("[chunked-edit-stream] editAt failed:", err);
      }
    } finally {
      this.lastFlushedAt = Date.now();
    }
  }
}

// ---------------------------------------------------------------------------
// ChunkedEditStream
// ---------------------------------------------------------------------------

export class ChunkedEditStream {
  private buffer = "";
  /** Sorted character positions where a chunk ends (= where the next begins). */
  private boundaries: number[] = [];
  private streams: EditStream[] = [];
  /** Serialises new-chunk creation so async postPlaceholder calls don't race. */
  private setupPromise: Promise<void> = Promise.resolve();
  private finished = false;

  private readonly limit: number;
  private readonly minIntervalMs: number;
  private readonly postPlaceholder: (text: string) => Promise<number>;
  private readonly editAt: (messageId: number, text: string) => Promise<void>;
  private readonly transform: (text: string) => string;

  constructor(config: ChunkedEditStreamConfig) {
    this.limit = config.limit ?? DEFAULT_LIMIT;
    this.minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.postPlaceholder = config.postPlaceholder;
    this.editAt = config.editAt;
    this.transform = config.transform ?? ((t) => t);
  }

  /**
   * Feed the FULL accumulated text so far. The stream will work out which
   * slice belongs to which Telegram message and throttle edits accordingly.
   */
  append(fullText: string): void {
    if (this.finished) return;
    if (fullText === this.buffer) return;
    this.buffer = fullText;
    this.refreezeBoundaries();
    this.setupPromise = this.setupPromise.then(() =>
      this.ensureStreamsAndDispatch(),
    );
  }

  /** Flush all pending edits and wait until every message reflects its final text. */
  async finish(): Promise<void> {
    this.finished = true;
    this.setupPromise = this.setupPromise.then(() =>
      this.ensureStreamsAndDispatch(),
    );
    await this.setupPromise;
    for (const s of this.streams) await s.finish();
  }

  /** Number of Telegram messages posted so far. */
  get chunkCount(): number {
    return this.streams.length;
  }

  /**
   * Walk forward from the last frozen boundary, freezing new ones whenever
   * the active chunk's length exceeds the soft limit. Choose the break point
   * at the last newline (or last space) within the window; fall back to a hard
   * cut if neither is found. Boundaries never move once frozen.
   */
  private refreezeBoundaries(): void {
    const minAdvance = Math.max(1, Math.floor(this.limit / 2));
    let lastFrozen = this.boundaries.at(-1) ?? 0;
    while (this.buffer.length - lastFrozen > this.limit) {
      const window = this.buffer.slice(lastFrozen, lastFrozen + this.limit);
      let breakAt = window.lastIndexOf("\n");
      if (breakAt < this.limit / 4) breakAt = window.lastIndexOf(" ");
      // Bug 1 fix: enforce a minimum advance floor so adversarial input
      // (e.g. leading spaces / early newlines) doesn't produce ~1-char chunks.
      if (breakAt < minAdvance) breakAt = this.limit - 1;
      const candidate = lastFrozen + breakAt + 1;
      this.boundaries.push(candidate);
      lastFrozen = candidate;
    }
  }

  private async ensureStreamsAndDispatch(): Promise<void> {
    if (this.buffer.length === 0) return;

    // Bug 2 fix: if the last boundary lands exactly at buffer.length the final
    // "chunk" would be an empty string — drop that phantom boundary so we don't
    // post a blank placeholder message.
    while (
      this.boundaries.length > 0 &&
      this.boundaries[this.boundaries.length - 1]! >= this.buffer.length
    ) {
      this.boundaries.pop();
    }

    const chunkCount = this.boundaries.length + 1;
    while (this.streams.length < chunkCount) {
      // Plain-text placeholder (no Markdown): postPlaceholder sends with
      // parse_mode:"HTML", so Markdown italics would render literal underscores.
      const placeholder = "…";
      const messageId = await this.postPlaceholder(placeholder);
      this.streams.push(
        new EditStream({
          update: (text) => this.editAt(messageId, this.transform(text) || " "),
          minIntervalMs: this.minIntervalMs,
        }),
      );
    }
    // Dispatch slices to each message's stream.
    for (let i = 0; i < chunkCount; i++) {
      const start = i === 0 ? 0 : this.boundaries[i - 1]!;
      const end =
        i < this.boundaries.length ? this.boundaries[i]! : this.buffer.length;
      const slice = this.buffer.slice(start, end);
      // Bug 2 fix: never dispatch an empty slice.
      if (slice.length > 0) {
        this.streams[i]!.append(slice);
      }
    }
  }
}
