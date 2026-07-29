import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplyTarget } from "@copilotkit/channels-core";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./in-memory-transports.js";
import type { ChannelRenderEvent } from "./contracts.js";
import type { RenderEventSink } from "./transports.js";

interface AcceptedBatch {
  batchId: string;
  startSeq: number;
  endSeq: number;
  frames: ReadonlyArray<{ seq: number; event: ChannelRenderEvent }>;
}

type Subscriber = Record<
  string,
  (payload: { event: Record<string, unknown> }) => unknown
>;

const target = {
  route: { channel: "C1", threadTs: "100.0" },
  turnId: "turn_dlv_batch",
  deliveryId: "dlv_batch",
} as unknown as ReplyTarget;

class RecordingBatchSink {
  readonly batches: AcceptedBatch[] = [];

  async pushBatch(batch: AcceptedBatch): Promise<{
    batchId: string;
    egressOperationId: string;
    acceptedThroughSeq: number;
    duplicate: boolean;
  }> {
    this.batches.push(batch);
    return {
      batchId: batch.batchId,
      egressOperationId: "eop_batch",
      acceptedThroughSeq: batch.endSeq,
      duplicate: false,
    };
  }
}

const createRenderer = (sink: RenderEventSink) => {
  const adapter = intelligenceAdapter({
    source: new InMemoryDeliverySource(),
    egress: new InMemoryEgressSink(),
    renderSink: sink,
  });
  const renderer = adapter.createRunRenderer(target);
  return {
    renderer,
    subscriber: renderer.subscriber as unknown as Subscriber,
  };
};

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("managed render batch compaction", () => {
  it("retries the same immutable batch after a transient acceptance failure", async () => {
    const attempts: AcceptedBatch[] = [];
    const sink: RenderEventSink = {
      pushBatch: async (batch) => {
        attempts.push(batch);
        if (attempts.length === 1) {
          throw new Error("network reset");
        }
        return {
          batchId: batch.batchId,
          egressOperationId: "eop_retry",
          acceptedThroughSeq: batch.endSeq,
          duplicate: true,
        };
      },
    };
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    });
    await renderer.finish?.();

    expect(attempts).toHaveLength(3);
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("flushes the first non-empty text immediately with contiguous post-compaction sequence numbers", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    });
    await settle();

    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toMatchObject({
      startSeq: 0,
      endSeq: 1,
      frames: [
        { seq: 0, event: { kind: "run_started" } },
        {
          seq: 1,
          event: { kind: "text_delta", messageId: "m1", delta: "hello" },
        },
      ],
    });
    await renderer.finish?.();
  });

  it("compacts later adjacent text for 250 ms and flushes before a semantic boundary", async () => {
    vi.useFakeTimers();
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    await settle();
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " second" },
    });
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " third" },
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(sink.batches).toHaveLength(1);

    subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    });
    await settle();

    expect(sink.batches).toHaveLength(2);
    expect(sink.batches[1]?.frames).toEqual([
      {
        seq: 2,
        event: {
          kind: "text_delta",
          messageId: "m1",
          delta: " second third",
        },
      },
      { seq: 3, event: { kind: "text_end", messageId: "m1" } },
    ]);
    await renderer.finish?.();
  });

  it("keeps equal 20-delta and 200-delta answers within one durable batch of each other", async () => {
    vi.useFakeTimers();

    const run = async (count: number): Promise<number> => {
      const sink = new RecordingBatchSink();
      const { renderer, subscriber } = createRenderer(sink);
      for (let index = 0; index < count; index += 1) {
        subscriber.onTextMessageContentEvent?.({
          event: { messageId: "m1", delta: "x" },
        });
      }
      subscriber.onTextMessageEndEvent?.({
        event: { messageId: "m1" },
      });
      await renderer.finish?.();
      return sink.batches.length;
    };

    const twenty = await run(20);
    const twoHundred = await run(200);

    expect(Math.abs(twenty - twoHundred)).toBeLessThanOrEqual(1);
  });
});
