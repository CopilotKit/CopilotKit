/**
 * Render-frame coalescing (OSS-648).
 *
 * A streaming reply emits one AG-UI `text_delta` per token, and each frame is
 * pushed to Intelligence and its durable acceptance receipt awaited before the
 * next one goes out. That makes reply latency scale with token count: a
 * 100-token reply costs 100 serialized round trips, which dominates everything
 * else in the egress path.
 *
 * Merging adjacent deltas removes that multiplier without changing what the
 * reader sees, because the provider side already throttles its own writes
 * (Slack's `chat.appendStream` floor is 600ms), so several tokens were going to
 * land in one provider update regardless.
 *
 * The rules exist to keep the merge invisible to everything downstream:
 *
 * - Only adjacent `text_delta` frames merge, and only when they carry the same
 *   `messageId`. A tool call, a discrete post, or a second message in the same
 *   turn ends the run, so relative order is never disturbed.
 * - A merged frame takes the seq of the LAST delta it absorbed. Seqs stay
 *   ascending and unique, the skipped ones are simply never pushed, and the
 *   turn's accepted high-water mark still advances monotonically.
 * - Merged text is capped, so one oversized frame can never breach the
 *   platform's per-delta limit.
 */

import type { ChannelRenderEvent } from "./contracts.js";

/**
 * Cap on merged `text_delta` characters per frame. The platform accepts 40 000,
 * and Slack's `chat.appendStream` takes 12 000 per call, so this sits under both
 * and keeps a merged frame within a single provider write.
 */
export const MAX_MERGED_DELTA_CHARS = 12_000;

/** A frame waiting to be pushed, with the seq already allocated at enqueue. */
export interface PendingRenderFrame {
  readonly seq: number;
  readonly event: ChannelRenderEvent;
}

/** A frame to push, plus how many enqueued events it represents. */
export interface CoalescedRenderFrame extends PendingRenderFrame {
  /** Enqueued events folded into this frame (1 when nothing merged). */
  readonly sourceEvents: number;
}

/** Narrow to a text delta without widening the union elsewhere. */
const asTextDelta = (
  event: ChannelRenderEvent,
): { messageId: string; delta: string } | undefined =>
  event.kind === "text_delta"
    ? { messageId: event.messageId, delta: event.delta }
    : undefined;

/**
 * Fold a buffered run of frames so adjacent same-message text deltas travel as
 * one frame.
 *
 * @param pending - Buffered frames in enqueue order, seqs ascending.
 * @param maxDeltaChars - Merged-text cap; defaults to
 *   {@link MAX_MERGED_DELTA_CHARS}.
 * @returns Frames to push, in order, each with its source-event count.
 */
export function coalesceRenderFrames(
  pending: readonly PendingRenderFrame[],
  maxDeltaChars: number = MAX_MERGED_DELTA_CHARS,
): CoalescedRenderFrame[] {
  const out: CoalescedRenderFrame[] = [];
  // The open merge run, or undefined when the last frame was not a text delta.
  let run:
    | {
        messageId: string;
        parts: string[];
        chars: number;
        seq: number;
        count: number;
      }
    | undefined;

  const closeRun = (): void => {
    if (!run) return;
    out.push({
      seq: run.seq,
      event: {
        kind: "text_delta",
        messageId: run.messageId,
        delta: run.parts.join(""),
      },
      sourceEvents: run.count,
    });
    run = undefined;
  };

  for (const entry of pending) {
    const text = asTextDelta(entry.event);
    if (!text) {
      closeRun();
      out.push({ ...entry, sourceEvents: 1 });
      continue;
    }
    // A different message ends the run: two messages must stay two frames.
    if (run && run.messageId !== text.messageId) closeRun();
    // Growing past the cap ends the run too. An already-oversized single delta
    // still goes out on its own rather than being dropped or split, which would
    // corrupt the text.
    if (run && run.chars + text.delta.length > maxDeltaChars) closeRun();
    if (!run) {
      run = {
        messageId: text.messageId,
        parts: [text.delta],
        chars: text.delta.length,
        seq: entry.seq,
        count: 1,
      };
      continue;
    }
    run.parts.push(text.delta);
    run.chars += text.delta.length;
    run.seq = entry.seq;
    run.count += 1;
  }
  closeRun();
  return out;
}
