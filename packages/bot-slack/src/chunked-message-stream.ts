import { MessageStream } from "./message-stream.js";
import {
  detectOpenContext,
  renderContextOpener,
} from "./auto-close-streaming.js";

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
 * Slack caps `chat.update` text at ~4000 chars. For longer agent responses we
 * spread the text over several Slack messages — but the *chunk boundaries*
 * must be stable once committed (we can't reflow a sentence into a previous
 * chunk after that chunk has already been posted to Slack).
 *
 * ChunkedMessageStream owns N underlying `MessageStream`s (one per Slack
 * message). It accepts the full accumulated text on `append()`, decides
 * where the chunk boundaries are, mints new Slack messages as needed,
 * and dispatches the right slice to each chunk's stream.
 *
 * Boundaries are chosen greedily: once an active chunk exceeds the soft
 * limit, freeze the boundary at the last newline (or last space) within
 * the limit; remaining text becomes the next chunk. Boundaries don't
 * move once frozen, so an already-posted chunk's text never shrinks.
 */
export interface ChunkedMessageStreamConfig {
  /** Soft per-message char limit. Defaults to 3500 (under Slack's ~4000). */
  limit?: number;
  /** Throttle floor for each underlying stream's chat.update. */
  minIntervalMs?: number;
  /** Posts a new Slack message with placeholder text; resolves with its `ts`. */
  postPlaceholder: (text: string) => Promise<string>;
  /** Updates the Slack message at `ts` with `text`. */
  updateAt: (ts: string, text: string) => Promise<void>;
  /**
   * Optional transformer for the text *just before* it hits chat.update —
   * e.g. markdown→mrkdwn translation. Applied per-chunk.
   */
  transform?: (text: string) => string;
}

const DEFAULT_LIMIT = 3500;

export class ChunkedMessageStream {
  private buffer = "";
  /** Sorted positions where a chunk ends (= where the next chunk begins). */
  private boundaries: number[] = [];
  private streams: MessageStream[] = [];
  /** Serialises new-chunk creation so async postPlaceholder calls don't race. */
  private setupPromise: Promise<void> = Promise.resolve();
  private finished = false;

  private readonly limit: number;
  private readonly minIntervalMs: number | undefined;
  private readonly postPlaceholder: (text: string) => Promise<string>;
  private readonly updateAt: (ts: string, text: string) => Promise<void>;
  private readonly transform: (text: string) => string;

  constructor(config: ChunkedMessageStreamConfig) {
    this.limit = config.limit ?? DEFAULT_LIMIT;
    this.minIntervalMs = config.minIntervalMs;
    this.postPlaceholder = config.postPlaceholder;
    this.updateAt = config.updateAt;
    this.transform = config.transform ?? ((t) => t);
  }

  append(fullText: string): void {
    if (this.finished) return;
    if (fullText === this.buffer) return;
    this.buffer = fullText;
    this.refreezeBoundaries();
    // Make sure we have one Slack message per chunk, then dispatch.
    this.setupPromise = this.setupPromise.then(() =>
      this.ensureStreamsAndDispatch(),
    );
  }

  async finish(): Promise<void> {
    this.finished = true;
    // Drain any pending setup, then a final dispatch, then finish each stream.
    this.setupPromise = this.setupPromise.then(() =>
      this.ensureStreamsAndDispatch(),
    );
    await this.setupPromise;
    for (const s of this.streams) await s.finish();
  }

  /** Returns the number of Slack messages this stream has posted so far. */
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
   * the next Slack message rather than being split. The previous chunk
   * gets shortened (chat.update will edit it down). Fallback when the
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
    // matters for the empty-response case (D20): a TEXT_MESSAGE_START + END
    // pair with no content events should produce no Slack message.
    if (this.buffer.length === 0) return;
    const chunkCount = this.boundaries.length + 1;
    while (this.streams.length < chunkCount) {
      const i = this.streams.length;
      const placeholder = i === 0 ? "_thinking…_" : "_…(continued)_";
      const ts = await this.postPlaceholder(placeholder);
      this.streams.push(
        new MessageStream({
          update: (text) => this.updateAt(ts, this.transform(text) || " "),
          minIntervalMs: this.minIntervalMs,
        }),
      );
    }
    // Dispatch slices.
    //
    // For continuation chunks (i > 0), if the boundary fell inside an open
    // markdown construct (e.g. inside a ```python block), prepend the
    // opener for that construct to the slice. Otherwise the second Slack
    // message would begin with raw code that Slack renders as plain text.
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
