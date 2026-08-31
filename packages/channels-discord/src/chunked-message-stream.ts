import { MessageStream } from "./message-stream.js";
import {
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";
import { discordMarkdown } from "./markdown.js";

/** Discord's hard per-message content limit. Edits above this are rejected. */
const DISCORD_HARD_LIMIT = 2000;

/**
 * Placeholder texts posted for streaming messages: the first chunk shows
 * "_thinking…_" and later (continuation) chunks show "_…(continued)_" until
 * real content lands. Exported as a shared const so the producer here and the
 * history filter in adapter.ts (which excludes the bot's own placeholders from
 * `read_thread`) never drift apart. The `…` is a real U+2026 ellipsis.
 */
export const STREAM_PLACEHOLDERS = ["_thinking…_", "_…(continued)_"] as const;

/**
 * Soft chunk limit. Sits ~100 chars below the hard limit to leave headroom
 * for the per-chunk transform, which can both append a closer ("\n```") and
 * prepend a continuation re-opener ("```longlangname\n").
 */
const DEFAULT_LIMIT = 1900;

/**
 * Last-resort safety net: guarantee a transformed chunk never exceeds
 * Discord's hard limit. The 1900-char soft limit is the primary defence;
 * this clamp only fires in pathological cases (e.g. an enormous re-opener
 * language tag). If truncation severs an open code fence, re-append a
 * closing fence so the message still renders as a balanced block — at the
 * cost of dropping the overflow characters, which is preferable to a
 * rejected edit that freezes the chunk on its placeholder.
 */
function clampToHardLimit(text: string): string {
  if (text.length <= DISCORD_HARD_LIMIT) return text;
  let clamped = text.slice(0, DISCORD_HARD_LIMIT);
  // Odd number of triple-backticks → an open fence was severed. Reserve room
  // for a "\n```" closer (4 chars) and re-append it to keep the fence balanced.
  if ((clamped.match(/```/g) || []).length % 2 === 1) {
    clamped = clamped.slice(0, DISCORD_HARD_LIMIT - 4) + "\n```";
  }
  return clamped;
}

/**
 * Position (0-based) of the unpaired opening ``` in `buffer.slice(0, end)`,
 * or null if all triple-backticks before `end` are paired.
 */
function findUnpairedFenceStart(buffer: string, end: number): number | null {
  const before = buffer.slice(0, end);
  const parts = before.split("```");
  // length is odd → balanced; even → one unpaired opener exists
  if (parts.length % 2 !== 0) return null;
  return before.lastIndexOf("```");
}

/**
 * Discord's HARD per-message content limit is 2000 chars. For longer agent
 * responses we spread the text over several Discord messages — but the
 * *chunk boundaries* must be stable once committed (we can't reflow a
 * sentence into a previous chunk after that chunk has already been posted
 * to Discord).
 *
 * ChunkedMessageStream owns N underlying `MessageStream`s (one per Discord
 * message). It accepts the full accumulated text on `append()`, decides
 * where the chunk boundaries are, mints new Discord messages as needed,
 * and dispatches the right slice to each chunk's stream.
 *
 * Boundaries are chosen greedily: once an active chunk exceeds the soft
 * limit, freeze the boundary at the last newline (or last space) within
 * the limit; remaining text becomes the next chunk. Boundaries don't
 * move once frozen, so an already-posted chunk's text never shrinks.
 */
export interface ChunkedMessageStreamConfig {
  /**
   * Soft per-message char limit used to choose chunk boundaries. Defaults to
   * 1900 — deliberately below Discord's 2000 hard limit so the per-chunk
   * `transform` has headroom to grow the text without overflowing. The
   * transform appends a fence/marker closer (autoCloseOpenMarkdown) and, for
   * continuation chunks, prepends a re-opener (e.g. "```longlangname\n"); a
   * chunk sliced to exactly 2000 raw chars would exceed 2000 once transformed
   * and Discord would reject the edit with BASE_TYPE_MAX_LENGTH.
   */
  limit?: number;
  /** Throttle floor for each underlying stream's message edit. */
  minIntervalMs?: number;
  /** Posts a new Discord message with placeholder text; resolves with its id. */
  postPlaceholder: (text: string) => Promise<string>;
  /** Updates the Discord message at `id` with `text`. */
  updateAt: (id: string, text: string) => Promise<void>;
  /**
   * Optional transformer for the text *just before* it hits the edit call —
   * e.g. markdown translation. Applied per-chunk.
   * Defaults to `discordMarkdown`.
   */
  transform?: (text: string) => string;
}

export class ChunkedMessageStream {
  private buffer = "";
  /** Sorted positions where a chunk ends (= where the next chunk begins). */
  private boundaries: number[] = [];
  private streams: MessageStream[] = [];
  /** Serialises new-chunk creation so async postPlaceholder calls don't race. */
  private setupPromise: Promise<void> = Promise.resolve();
  /**
   * Records the first setup-chain failure (e.g. a rejecting `postPlaceholder`).
   * The chain itself is kept rejection-free via a `.catch` so no interim
   * unhandled promise rejection is emitted; the stored error is rethrown
   * deterministically at the next `append`/`finish`.
   */
  private setupError: unknown = undefined;
  private finished = false;

  private readonly limit: number;
  private readonly minIntervalMs: number | undefined;
  private readonly postPlaceholder: (text: string) => Promise<string>;
  private readonly updateAt: (id: string, text: string) => Promise<void>;
  private readonly transform: (text: string) => string;

  constructor(config: ChunkedMessageStreamConfig) {
    this.limit = config.limit ?? DEFAULT_LIMIT;
    this.minIntervalMs = config.minIntervalMs;
    this.postPlaceholder = config.postPlaceholder;
    this.updateAt = config.updateAt;
    this.transform = config.transform ?? discordMarkdown;
  }

  append(fullText: string): void {
    if (this.finished) return;
    // A prior setup-chain failure is fatal for the stream — surface it
    // synchronously here rather than chaining more work onto a doomed promise.
    if (this.setupError !== undefined) throw this.asSetupError();
    if (fullText === this.buffer) return;
    this.buffer = fullText;
    this.refreezeBoundaries();
    // Make sure we have one Discord message per chunk, then dispatch. The
    // `.catch` keeps `setupPromise` itself rejection-free (no unhandled
    // rejection between this append and the next surfacing point); the failure
    // is recorded once and rethrown at the next append/finish.
    this.setupPromise = this.setupPromise
      .then(() => this.ensureStreamsAndDispatch())
      .catch((err) => {
        if (this.setupError === undefined) this.setupError = err;
      });
  }

  async finish(): Promise<void> {
    this.finished = true;
    // Drain any pending setup, then a final dispatch, then finish each stream.
    this.setupPromise = this.setupPromise
      .then(() => this.ensureStreamsAndDispatch())
      .catch((err) => {
        if (this.setupError === undefined) this.setupError = err;
      });
    await this.setupPromise;
    // Surface a setup failure (e.g. a rejecting postPlaceholder) here so the
    // caller still sees it — just without an interim unhandled rejection.
    if (this.setupError !== undefined) throw this.asSetupError();
    for (const s of this.streams) await s.finish();
  }

  /** Wraps the recorded setup failure with context for surfacing to callers. */
  private asSetupError(): Error {
    const cause = this.setupError;
    return new Error("ChunkedMessageStream setup failed", { cause });
  }

  /** Returns the number of Discord messages this stream has posted so far. */
  get chunkCount(): number {
    return this.streams.length;
  }

  /**
   * Walk forward from the last frozen boundary, freezing new ones whenever
   * the active chunk's length exceeds the soft limit. Once frozen, a
   * boundary doesn't move.
   *
   * Special case (block-keeps-whole): if the chosen boundary lands INSIDE
   * an open fenced code block, we try to move the boundary BACK to the
   * position right before the fence opener, so the *whole* block lives in
   * the next Discord message rather than being split. The previous chunk
   * gets shortened (message edit will update it down). Fallback when the
   * block is too large to fit in one chunk: keep the inside-fence
   * boundary; the dispatcher will prepend the fence opener to the next
   * chunk (re-opener path).
   */
  private refreezeBoundaries(): void {
    let lastFrozen = this.boundaries.at(-1) ?? 0;
    while (this.buffer.length - lastFrozen > this.limit) {
      const window = this.buffer.slice(lastFrozen, lastFrozen + this.limit);
      let breakAt = window.lastIndexOf("\n");
      if (breakAt < this.limit / 4) breakAt = window.lastIndexOf(" ");
      if (breakAt < 0) breakAt = this.limit - 1;
      let candidate = lastFrozen + breakAt + 1;

      // Block-keeps-whole: move boundary back if it lands inside an open
      // fence. Only adjust if the fence opener is in the latter ~70% of
      // the active chunk — otherwise shrinking would lose too much
      // content (chunk N would be tiny) and the re-opener path is better.
      const fenceStart = findUnpairedFenceStart(this.buffer, candidate);
      if (fenceStart !== null) {
        const minAcceptable = lastFrozen + Math.floor(this.limit * 0.3);
        if (fenceStart > minAcceptable) {
          candidate = fenceStart;
        }
      }

      this.boundaries.push(candidate);
      lastFrozen = candidate;
    }
  }

  private async ensureStreamsAndDispatch(): Promise<void> {
    // If we've never received any content, don't post a placeholder. This
    // matters for the empty-response case: a TEXT_MESSAGE_START + END
    // pair with no content events should produce no Discord message.
    if (this.buffer.length === 0) return;
    const chunkCount = this.boundaries.length + 1;
    while (this.streams.length < chunkCount) {
      const i = this.streams.length;
      const placeholder =
        i === 0 ? STREAM_PLACEHOLDERS[0] : STREAM_PLACEHOLDERS[1];
      const id = await this.postPlaceholder(placeholder);
      this.streams.push(
        new MessageStream({
          update: (text) =>
            this.updateAt(id, clampToHardLimit(this.transform(text)) || " "),
          minIntervalMs: this.minIntervalMs,
        }),
      );
    }
    // Dispatch slices.
    //
    // For continuation chunks (i > 0), if the boundary fell inside an open
    // markdown construct (e.g. inside a ```python block), prepend the
    // opener for that construct to the slice. Otherwise the second Discord
    // message would begin with raw code that Discord renders as plain text.
    // The closer at the end of the chunk is added by `transform`
    // (autoCloseOpenMarkdown), which runs per chunk.
    for (let i = 0; i < chunkCount; i++) {
      const start = i === 0 ? 0 : this.boundaries[i - 1]!;
      const end =
        i < this.boundaries.length ? this.boundaries[i]! : this.buffer.length;
      let slice = this.buffer.slice(start, end);
      if (i > 0) {
        const ctx = detectOpenContext(this.buffer.slice(0, start));
        const opener = renderContextOpener(ctx);
        if (opener) slice = opener + slice;
      }
      this.streams[i]!.append(slice);
    }
  }
}
