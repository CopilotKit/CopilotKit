import { createHash } from "node:crypto";
import type {
  ChannelRenderEvent,
  RenderBatch,
  RenderFrame,
} from "./contracts.js";

export const RENDER_BATCH_PROTOCOL_CAPABILITY = "render_batch_v1";
export const RENDER_TEXT_FLUSH_MS = 250;
export const RENDER_TEXT_MAX_BYTES = 16 * 1024;
export const RENDER_BATCH_MAX_FRAMES = 64;
export const RENDER_BATCH_MAX_BYTES = 128 * 1024;
export const RENDER_LANE_MAX_PENDING_BYTES = 256 * 1024;

const canonicalFrames = (frames: readonly RenderFrame[]): string =>
  JSON.stringify(
    frames.map((frame) => ({
      seq: frame.seq,
      event: frame.event,
    })),
  );

/** Return the UTF-8 wire size for a value encoded as JSON. */
export const encodedJsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * Build one immutable render batch with a content-derived stable identifier.
 *
 * @param identity - Delivery, turn, and lane identity.
 * @param frames - Contiguous compacted frames.
 * @returns A frozen batch whose digest and identifier survive exact retries.
 */
export const createRenderBatch = (
  identity: Pick<RenderBatch, "deliveryId" | "turnId" | "slot">,
  frames: readonly RenderFrame[],
): RenderBatch => {
  if (frames.length === 0) {
    throw new Error("render batch requires at least one frame");
  }
  const startSeq = frames[0]!.seq;
  const endSeq = frames[frames.length - 1]!.seq;
  const contentDigest = createHash("sha256")
    .update(canonicalFrames(frames))
    .digest("hex");
  return Object.freeze({
    ...identity,
    batchId: `rb_${startSeq}_${endSeq}_${contentDigest.slice(0, 24)}`,
    contentDigest,
    startSeq,
    endSeq,
    frames: Object.freeze(
      frames.map((frame) =>
        Object.freeze({
          seq: frame.seq,
          event: frame.event,
        }),
      ),
    ),
  });
};

/** Return true when two text events may be compacted without changing meaning. */
export const canCompactText = (
  left: ChannelRenderEvent,
  right: ChannelRenderEvent,
): left is Extract<ChannelRenderEvent, { kind: "text_delta" }> =>
  left.kind === "text_delta" &&
  right.kind === "text_delta" &&
  left.messageId === right.messageId;
