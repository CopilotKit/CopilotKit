import { MessageStream } from "./message-stream.js";

const FENCE = "```";

/**
 * Position (0-based) of the unpaired opening ``` in `buffer.slice(0, end)`,
 * or null if all triple-backticks before `end` are paired.
 */
function findUnpairedFenceStart(buffer: string, end: number): number | null {
  const before = buffer.slice(0, end);
  const parts = before.split(FENCE);
  // length is odd → balanced; even → one unpaired opener exists
  if (parts.length % 2 !== 0) return null;
  return before.lastIndexOf(FENCE);
}

/** Number of triple-backtick fences in `text`. */
function countFences(text: string): number {
  return text.split(FENCE).length - 1;
}

/**
 * Make a single dispatched chunk independently fence-balanced.
 *
 * `openBefore` says whether this chunk begins INSIDE a fenced block that was
 * opened in an earlier chunk (the running fence count before the slice is
 * odd). When so, prepend a bare reopener so the continuation renders as code;
 * the per-chunk markdown transform leaves fenced regions untouched, so we
 * balance the raw slice text here, before transform.
 *
 * Returns the (possibly) wrapped text plus whether the block is still open at
 * the END of this chunk (so the next chunk knows to reopen).
 */
function balanceFences(
  slice: string,
  openBefore: boolean,
): { text: string; openAfter: boolean } {
  let text = slice;
  // Continuation of a block opened in a previous chunk: reopen the fence so
  // this slice renders as code on its own. (Language hint is lost — fine for v1.)
  if (openBefore) text = FENCE + "\n" + text;

  // Total fences now visible in this self-contained chunk. Odd → the chunk
  // ends with an unclosed fence; append a closer on its own line.
  const fenceCount = (openBefore ? 1 : 0) + countFences(slice);
  const endsOpen = fenceCount % 2 !== 0;
  if (endsOpen) {
    text = text.endsWith("\n") ? text + FENCE : text + "\n" + FENCE;
  }
  return { text, openAfter: endsOpen };
}

/**
 * Google Chat caps message text at ~4096 chars. For longer agent responses we
 * spread the text over several Google Chat messages — but the *chunk boundaries*
 * must be stable once committed (we can't reflow a sentence into a previous
 * chunk after that chunk has already been posted to Google Chat).
 *
 * ChunkedMessageStream owns N underlying `MessageStream`s (one per Google Chat
 * message). It accepts the full accumulated text on `append()`, decides
 * where the chunk boundaries are, mints new Google Chat messages as needed,
 * and dispatches the right slice to each chunk's stream.
 *
 * Boundaries are chosen greedily: once an active chunk exceeds the soft
 * limit, freeze the boundary at the last newline (or last space) within
 * the limit; remaining text becomes the next chunk. Boundaries don't
 * move once frozen, so an already-posted chunk's text never shrinks.
 */
export interface ChunkedMessageStreamConfig {
  /** Soft per-message char limit. Defaults to 3900 (under Google Chat's ~4096). */
  limit?: number;
  /** Throttle floor for each underlying stream's update. */
  minIntervalMs?: number;
  /** Posts a new Google Chat message with placeholder text; resolves with its resource name. */
  postPlaceholder: (text: string) => Promise<string>;
  /** Updates the Google Chat message at `name` with `text`. */
  updateAt: (name: string, text: string) => Promise<void>;
  /**
   * Optional transformer for the text *just before* it hits the update call —
   * e.g. markdown→chat translation. Applied per-chunk.
   */
  transform?: (text: string) => string;
}

const DEFAULT_LIMIT = 3900;

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
  private readonly updateAt: (name: string, text: string) => Promise<void>;
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
    // Make sure we have one Google Chat message per chunk, then dispatch.
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

  /** Returns the number of Google Chat messages this stream has posted so far. */
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
   * the next Google Chat message rather than being split. The previous chunk
   * gets shortened (the update will edit it down). Fallback when the
   * block is too large to fit in one chunk: keep the inside-fence boundary.
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
      // content (chunk N would be tiny).
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
    // pair with no content events should produce no Google Chat message.
    if (this.buffer.length === 0) return;
    const chunkCount = this.boundaries.length + 1;
    while (this.streams.length < chunkCount) {
      const i = this.streams.length;
      const placeholder = i === 0 ? "_thinking…_" : "_…(continued)_";
      const name = await this.postPlaceholder(placeholder);
      this.streams.push(
        new MessageStream({
          update: (text) => this.updateAt(name, this.transform(text) || " "),
          minIntervalMs: this.minIntervalMs,
        }),
      );
    }
    // Dispatch slices. Each chunk is made independently fence-balanced so a
    // fenced code block that straddles a boundary doesn't render as an
    // unterminated fence in one message and code-styled text in the next.
    // `openBefore` carries whether the previous chunk ended mid-fence.
    let openBefore = false;
    for (let i = 0; i < chunkCount; i++) {
      const start = i === 0 ? 0 : this.boundaries[i - 1]!;
      const end =
        i < this.boundaries.length ? this.boundaries[i]! : this.buffer.length;
      const slice = this.buffer.slice(start, end);
      const { text, openAfter } = balanceFences(slice, openBefore);
      openBefore = openAfter;
      this.streams[i]!.append(text);
    }
  }
}
