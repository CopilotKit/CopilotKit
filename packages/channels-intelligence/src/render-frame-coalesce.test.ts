import { describe, it, expect } from "vitest";
import {
  coalesceRenderFrames,
  MAX_MERGED_DELTA_CHARS,
} from "./render-frame-coalesce.js";
import type { ChannelRenderEvent } from "./contracts.js";

/** Build a pending entry, numbering seqs in call order. */
const p = (seq: number, event: ChannelRenderEvent) => ({ seq, event });
const delta = (messageId: string, text: string): ChannelRenderEvent => ({
  kind: "text_delta",
  messageId,
  delta: text,
});

describe("coalesceRenderFrames", () => {
  it("returns an empty list for no input", () => {
    expect(coalesceRenderFrames([])).toEqual([]);
  });

  it("merges a run of same-message deltas into one frame at the run's last seq", () => {
    const out = coalesceRenderFrames([
      p(0, delta("m1", "Hel")),
      p(1, delta("m1", "lo ")),
      p(2, delta("m1", "world")),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      seq: 2,
      event: delta("m1", "Hello world"),
      sourceEvents: 3,
    });
  });

  it("passes non-text frames through untouched and in order", () => {
    const out = coalesceRenderFrames([
      p(0, { kind: "run_started" }),
      p(1, delta("m1", "a")),
      p(2, { kind: "tool_start", toolCallId: "tc1", toolName: "search" }),
      p(3, { kind: "finalize" }),
    ]);

    expect(out.map((f) => [f.seq, f.event.kind, f.sourceEvents])).toEqual([
      [0, "run_started", 1],
      [1, "text_delta", 1],
      [2, "tool_start", 1],
      [3, "finalize", 1],
    ]);
  });

  it("never merges across a non-text frame, so ordering is preserved", () => {
    const out = coalesceRenderFrames([
      p(0, delta("m1", "before ")),
      p(1, { kind: "tool_start", toolCallId: "tc1", toolName: "s" }),
      p(2, delta("m1", "after")),
    ]);

    expect(out.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(out[0]?.event).toEqual(delta("m1", "before "));
    expect(out[2]?.event).toEqual(delta("m1", "after"));
  });

  it("never merges deltas from different messages", () => {
    const out = coalesceRenderFrames([
      p(0, delta("m1", "one")),
      p(1, delta("m2", "two")),
    ]);

    expect(out).toHaveLength(2);
    expect(out[0]?.event).toEqual(delta("m1", "one"));
    expect(out[1]?.event).toEqual(delta("m2", "two"));
  });

  it("splits a merged run that would exceed the char cap", () => {
    const out = coalesceRenderFrames(
      [
        p(0, delta("m1", "aaaa")),
        p(1, delta("m1", "bbbb")),
        p(2, delta("m1", "cccc")),
      ],
      10,
    );

    // 4+4 fits in 10; adding the third would reach 12, so it starts a new frame.
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      seq: 1,
      event: delta("m1", "aaaabbbb"),
      sourceEvents: 2,
    });
    expect(out[1]).toEqual({
      seq: 2,
      event: delta("m1", "cccc"),
      sourceEvents: 1,
    });
  });

  it("passes through a single delta already larger than the cap", () => {
    const big = "x".repeat(25);
    const out = coalesceRenderFrames([p(0, delta("m1", big))], 10);

    expect(out).toHaveLength(1);
    expect(out[0]?.event).toEqual(delta("m1", big));
  });

  it("keeps every seq unique and ascending, and loses no text", () => {
    const pending = Array.from({ length: 50 }, (_, i) =>
      p(i, delta("m1", `${i},`)),
    );
    const out = coalesceRenderFrames(pending, 12);

    const seqs = out.map((f) => f.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    // Concatenating the merged deltas reproduces the original stream exactly.
    const merged = out
      .map((f) => (f.event as { delta: string }).delta)
      .join("");
    expect(merged).toBe(pending.map((x) => `${x.seq},`).join(""));
    // Every source event is accounted for exactly once.
    expect(out.reduce((n, f) => n + f.sourceEvents, 0)).toBe(50);
  });

  it("defaults the cap well under the platform's 40k delta limit", () => {
    expect(MAX_MERGED_DELTA_CHARS).toBeLessThan(40_000);
    expect(MAX_MERGED_DELTA_CHARS).toBeGreaterThan(0);
  });
});
