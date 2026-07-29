import { describe, expect, it } from "vitest";
import type { RenderBatch, RenderBatchAccepted } from "./contracts.js";
import { createRenderBatch } from "./render-batches.js";
import type { RenderEventSink } from "./transports.js";

class PlatformLikeBatchSink implements RenderEventSink {
  private readonly rows = new Map<
    string,
    { digest: string; receipt: RenderBatchAccepted }
  >();

  async pushBatch(batch: RenderBatch): Promise<RenderBatchAccepted> {
    const existing = this.rows.get(batch.batchId);
    if (existing) {
      if (existing.digest !== batch.contentDigest) {
        throw new Error(`CHANNEL_RENDER_BATCH_CONFLICT at ${batch.batchId}`);
      }
      return { ...existing.receipt, duplicate: true };
    }
    const receipt = {
      batchId: batch.batchId,
      egressOperationId: "eop_replay",
      acceptedThroughSeq: batch.endSeq,
      duplicate: false,
    };
    this.rows.set(batch.batchId, {
      digest: batch.contentDigest,
      receipt,
    });
    return receipt;
  }
}

describe("render batch retry stability", () => {
  it("keeps an unacknowledged batch immutable and returns the original high water on exact retry", async () => {
    const sink = new PlatformLikeBatchSink();
    const batch = createRenderBatch(
      {
        deliveryId: "dlv_replay",
        turnId: "turn_dlv_replay",
        slot: "main",
      },
      [
        { seq: 0, event: { kind: "run_started" } },
        {
          seq: 1,
          event: {
            kind: "text_delta",
            messageId: "m1",
            delta: "stable",
          },
        },
      ],
    );

    const first = await sink.pushBatch(batch);
    const retry = await sink.pushBatch(batch);

    expect(Object.isFrozen(batch)).toBe(true);
    expect(retry).toEqual({ ...first, duplicate: true });
    expect(retry.acceptedThroughSeq).toBe(1);
  });

  it("changes the stable batch identifier when compacted content changes", () => {
    const identity = {
      deliveryId: "dlv_replay",
      turnId: "turn_dlv_replay",
      slot: "main",
    };
    const first = createRenderBatch(identity, [
      {
        seq: 0,
        event: { kind: "text_delta", messageId: "m1", delta: "a" },
      },
    ]);
    const changed = createRenderBatch(identity, [
      {
        seq: 0,
        event: { kind: "text_delta", messageId: "m1", delta: "b" },
      },
    ]);

    expect(changed.contentDigest).not.toBe(first.contentDigest);
    expect(changed.batchId).not.toBe(first.batchId);
  });

  it("keeps the digest stable when rich-content object keys are reordered", () => {
    const identity = {
      deliveryId: "dlv_replay",
      turnId: "turn_dlv_replay",
      slot: "main",
    };
    const first = createRenderBatch(identity, [
      {
        seq: 0,
        event: {
          kind: "post",
          content: [
            {
              type: "section",
              props: { beta: "b", alpha: { two: 2, one: 1 } },
            },
          ],
        },
      },
    ]);
    const reordered = createRenderBatch(identity, [
      {
        seq: 0,
        event: {
          kind: "post",
          content: [
            {
              props: { alpha: { one: 1, two: 2 }, beta: "b" },
              type: "section",
            },
          ],
        },
      },
    ]);

    expect(reordered.contentDigest).toBe(first.contentDigest);
    expect(reordered.batchId).toBe(first.batchId);
  });
});
