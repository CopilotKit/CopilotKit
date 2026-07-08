import { describe, it, expect } from "vitest";
import { ChunkedEditStream } from "../chunked-edit-stream.js";

describe("ChunkedEditStream", () => {
  it("posts a placeholder then edits it with accumulated text", async () => {
    let id = 0;
    const edits: Record<number, string> = {};
    const s = new ChunkedEditStream({
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async (mid, text) => {
        edits[mid] = text;
      },
    });
    s.append("Hello");
    s.append("Hello world");
    await s.finish();
    expect(s.chunkCount).toBe(1);
    expect(edits[1]).toContain("Hello world");
  });
  it("spills past the limit into a second message", async () => {
    let id = 0;
    const ids: number[] = [];
    const s = new ChunkedEditStream({
      limit: 10,
      minIntervalMs: 0,
      postPlaceholder: async () => {
        ids.push(++id);
        return id;
      },
      editAt: async () => {},
    });
    s.append("x".repeat(25));
    await s.finish();
    expect(s.chunkCount).toBeGreaterThan(1);
    expect(ids.length).toBe(s.chunkCount);
  });

  it("retries text delivery after a transient intermediate-flush failure", async () => {
    // Scenario: scheduled intermediate flush fails (non-terminal, so swallowed),
    // then finish()'s terminal flush succeeds. posted must NOT have advanced on
    // the failed intermediate flush, allowing the terminal flush to re-attempt.
    let id = 0;
    const edits: Record<number, string> = {};
    let callCount = 0;
    // Resolves the instant the intermediate flush's editAt runs, so the test
    // waits for the actual condition instead of guessing a duration. An arbitrary
    // `setTimeout(r, 10)` here is a race: under CI scheduling jitter the internal
    // setTimeout(0) + microtask chain can miss the window, leaving callCount at 0.
    let firstFlushRan!: () => void;
    const firstFlush = new Promise<void>((r) => (firstFlushRan = r));
    const s = new ChunkedEditStream({
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async (mid, text) => {
        callCount++;
        if (callCount === 1) {
          firstFlushRan();
          throw new Error("transient network error");
        }
        edits[mid] = text;
      },
    });
    s.append("Hello world");
    // Wait until the intermediate flush has actually run and failed.
    await firstFlush;
    // The intermediate flush ran and failed (callCount === 1). posted is still "".
    expect(callCount).toBe(1);
    // finish() enqueues a terminal flush. Since posted="", it re-attempts.
    await s.finish();
    // The final text must have been delivered on the second attempt.
    expect(edits[1]).toContain("Hello world");
  });

  it("does not advance posted on failed intermediate flush, so next flush retries", async () => {
    // Verifies the invariant: posted stays at its old value when update() throws,
    // meaning a later flush will see buffer !== posted and re-send.
    let id = 0;
    const sentTexts: string[] = [];
    let callCount = 0;
    // Resolves the instant the intermediate flush's editAt runs, so the test
    // waits for the actual condition instead of guessing a duration. An arbitrary
    // `setTimeout(r, 10)` here is a race: under CI scheduling jitter the internal
    // setTimeout(0) + microtask chain can miss the window, leaving callCount at 0.
    let firstFlushRan!: () => void;
    const firstFlush = new Promise<void>((r) => (firstFlushRan = r));
    const s = new ChunkedEditStream({
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async (_mid, text) => {
        callCount++;
        if (callCount === 1) {
          // First call (intermediate flush) fails — posted must NOT advance.
          firstFlushRan();
          throw new Error("first call fails");
        }
        sentTexts.push(text);
      },
    });
    s.append("payload");
    // Wait until the intermediate flush has actually run and failed.
    await firstFlush;
    expect(callCount).toBe(1); // intermediate flush ran and failed
    // Terminal flush in finish() re-attempts because posted is still "".
    await s.finish();
    // payload must have been delivered on the second attempt.
    expect(sentTexts).toContain("payload");
  });

  it("finish() rejects when the terminal flush fails", async () => {
    let id = 0;
    const terminalError = new Error("terminal edit failure");
    const s = new ChunkedEditStream({
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async () => {
        throw terminalError;
      },
    });
    s.append("some text");
    await expect(s.finish()).rejects.toThrow("terminal edit failure");
  });

  // Bug 1 regression: adversarial input of mostly spaces must NOT produce
  // one Telegram message per character (min-advance floor).
  it("does not spam messages for a buffer of mostly spaces", async () => {
    const LIMIT = 20;
    let id = 0;
    const s = new ChunkedEditStream({
      limit: LIMIT,
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async () => {},
    });
    // ~2.5× limit of spaces — without the floor this would produce ~50 chunks.
    s.append(" ".repeat(50));
    await s.finish();
    // With the floor each chunk consumes at least limit/2 = 10 chars,
    // so we need at most ceil(50 / 10) = 5 chunks. Be generous: ≤ 6.
    expect(s.chunkCount).toBeLessThanOrEqual(6);
    expect(s.chunkCount).toBeGreaterThan(1); // still splits at all
  });

  // Bug 2 regression: input whose length is an exact multiple of the limit
  // must NOT produce a trailing empty message.
  it("does not post a blank trailing message when length is an exact multiple of limit", async () => {
    const LIMIT = 10;
    let id = 0;
    const placeholders: string[] = [];
    const edits: Record<number, string[]> = {};
    const s = new ChunkedEditStream({
      limit: LIMIT,
      minIntervalMs: 0,
      postPlaceholder: async (text) => {
        placeholders.push(text);
        const mid = ++id;
        edits[mid] = [];
        return mid;
      },
      editAt: async (mid, text) => {
        edits[mid]!.push(text);
      },
    });
    // Exactly 2× limit — old code would push a boundary at position 20 == buffer.length
    // and then try to post a third message with an empty slice.
    s.append("x".repeat(20));
    await s.finish();
    // Only 2 non-empty chunks expected; no blank third message.
    expect(s.chunkCount).toBe(2);
    // Verify exactly 2 placeholders were posted (no phantom trailing message).
    expect(placeholders.length).toBe(2);
    // Verify no empty string was ever dispatched to editAt.
    for (const sent of Object.values(edits)) {
      for (const text of sent) {
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  // HTML-expansion headroom: each raw chunk must fit within DEFAULT_LIMIT (2048)
  // so that telegramHtml expansion cannot push the rendered output past 4096.
  it("splits a 5000-char input into chunks whose raw slice length is <= default limit (2048)", async () => {
    const DEFAULT_LIMIT = 2048; // Math.floor(4096 / 2)
    let id = 0;
    const slices: string[] = [];
    // We intercept raw slices via a transform that records the pre-transform text.
    const s = new ChunkedEditStream({
      minIntervalMs: 0,
      postPlaceholder: async () => ++id,
      editAt: async (_mid, text) => {
        slices.push(text);
      },
      // transform records the raw text (identity so editAt receives raw length)
      transform: (t) => t,
    });
    s.append("a".repeat(5000));
    await s.finish();
    // Each slice recorded in editAt must have been <= DEFAULT_LIMIT raw chars.
    for (const slice of slices) {
      expect(slice.length).toBeLessThanOrEqual(DEFAULT_LIMIT);
    }
    // Must have split into multiple chunks.
    expect(s.chunkCount).toBeGreaterThan(1);
  });

  // Bug 3 regression: placeholder text must not contain Markdown underscore syntax.
  it("posts plain-text placeholders (no markdown underscores)", async () => {
    let id = 0;
    const placeholders: string[] = [];
    const s = new ChunkedEditStream({
      limit: 10,
      minIntervalMs: 0,
      postPlaceholder: async (text) => {
        placeholders.push(text);
        return ++id;
      },
      editAt: async () => {},
    });
    // Two chunks worth of text to exercise both placeholder strings.
    s.append("x".repeat(25));
    await s.finish();
    for (const p of placeholders) {
      expect(p).not.toContain("_");
    }
  });
});
