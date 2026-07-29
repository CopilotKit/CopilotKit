import { createHash } from "node:crypto";
import type {
  ChannelRenderEvent,
  RenderBatch,
  RenderFrame,
} from "./contracts.js";

export const RENDER_BATCH_PROTOCOL_CAPABILITY = "render_batch_v1";
export const RENDER_TEXT_MAX_DELTAS = 256;
export const RENDER_TEXT_MAX_BYTES = 16 * 1024;
export const RENDER_TEXT_TAIL_FLUSH_MS = 250;

/** Base render lane name, used when no attempt discriminator is available. */
export const RENDER_LANE_BASE_SLOT = "main";

/**
 * Derive the render lane (`slot`) for one delivery ATTEMPT.
 *
 * The durable egress lane is keyed `${turnId}:${slot}` on the platform side, and
 * `turnId` is a pure function of `deliveryId` — so every attempt of a delivery
 * shares one lane and one `accepted_high_water`. That forces a replayed attempt
 * to reproduce byte-identical batch boundaries: a re-cut batch is not found by
 * `batchId`, falls through to the `startSeq === high_water + 1` check, and the
 * turn dies on a sequence gap. Since a replayed agent run only reproduces
 * identical frames when the agent itself is deterministic, that constraint
 * protects a narrow case while breaking the common one.
 *
 * Giving each attempt its own lane removes the collision: attempt N+1 starts
 * from an empty high-water and streams its own frames. The trade — a product
 * decision, not a mechanical one — is that a redelivery now RE-RENDERS
 * (duplicate provider output) where it previously failed closed on the gap.
 *
 * The lease token is hashed rather than embedded: `slot` is persisted on every
 * render acceptance and is operator-readable, while the raw token is the lease
 * capability the platform fences accept/ack/fail against.
 *
 * @param leaseToken - Lease token for this attempt, when the source leases.
 * @returns A slot matching the platform's `[A-Za-z0-9_-]{1,64}` slot charset.
 */
export const renderLaneSlot = (leaseToken?: string): string => {
  if (!leaseToken) return RENDER_LANE_BASE_SLOT;
  const digest = createHash("sha256").update(leaseToken).digest("hex");
  return `${RENDER_LANE_BASE_SLOT}-${digest.slice(0, 12)}`;
};
export const RENDER_BATCH_MAX_FRAMES = 64;
export const RENDER_BATCH_MAX_BYTES = 128 * 1024;
export const RENDER_LANE_MAX_PENDING_BYTES = 256 * 1024;

/**
 * Encode JSON with object keys sorted recursively.
 *
 * @param value - JSON-compatible render data.
 * @returns Stable JSON across JavaScript and gateway map round-trips.
 */
export const stableRenderJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableRenderJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableRenderJson(entryValue)}`,
    )
    .join(",")}}`;
};

const canonicalFrames = (frames: readonly RenderFrame[]): string =>
  stableRenderJson(
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
