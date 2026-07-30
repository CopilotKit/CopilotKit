import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReplyTarget } from "@copilotkit/channels-core";
import {
  intelligenceAdapter,
  intelligenceAdapterInternal,
} from "./intelligence-adapter.js";
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

const createTerminalBatchingRenderer = (sink: RenderEventSink) => {
  const adapter = intelligenceAdapterInternal(
    {
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink: sink,
    },
    { terminalBatchingEnabled: true },
  );
  const renderer = adapter.createRunRenderer(target);
  return {
    adapter,
    renderer,
    subscriber: renderer.subscriber as unknown as Subscriber,
  };
};

const settle = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
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

    expect(attempts).toHaveLength(4);
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("waits before retrying a batch rejected while app-api is busy", async () => {
    vi.useFakeTimers();
    const attempts: AcceptedBatch[] = [];
    const sink: RenderEventSink = {
      pushBatch: async (batch) => {
        attempts.push(batch);
        if (attempts.length === 1) {
          throw new Error("app_api_busy");
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
    const finishing = renderer.finish?.();
    await settle();

    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await finishing;
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("does not retry a batch rejected with a permanent transport code", async () => {
    vi.useFakeTimers();
    const attempts: AcceptedBatch[] = [];
    const sink: RenderEventSink = {
      pushBatch: async (batch) => {
        attempts.push(batch);
        throw Object.assign(new Error("render batch rejected"), {
          code: "CHANNEL_RENDER_BATCH_CONFLICT",
        });
      },
    };
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    });
    const finishing = renderer.finish?.();
    await settle();

    expect(attempts).toHaveLength(1);
    const rejected = expect(finishing).rejects.toMatchObject({
      code: "CHANNEL_RENDER_BATCH_CONFLICT",
    });
    await vi.runAllTimersAsync();
    await rejected;
    expect(attempts).toHaveLength(1);
  });

  it("keeps eager first-text streaming when terminal batching is disabled", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    });
    await settle();

    expect(sink.batches).toHaveLength(2);
    expect(sink.batches[0]).toMatchObject({
      startSeq: 0,
      endSeq: 0,
      frames: [{ seq: 0, event: { kind: "run_started" } }],
    });
    await renderer.finish?.();

    expect(sink.batches[1]).toMatchObject({
      startSeq: 1,
      endSeq: 1,
      frames: [
        {
          seq: 1,
          event: { kind: "text_delta", messageId: "m1", delta: "hello" },
        },
      ],
    });
  });

  it("holds a bounded effect-free run and submits one ordered terminal batch on success", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createTerminalBatchingRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello " },
    });
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "world" },
    });
    subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "tc1", toolCallName: "search" },
    });
    subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "tc1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    subscriber.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    await settle();

    expect(sink.batches).toHaveLength(0);
    await renderer.finish?.();

    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]?.frames).toEqual([
      { seq: 0, event: { kind: "run_started" } },
      {
        seq: 1,
        event: {
          kind: "text_delta",
          messageId: "m1",
          delta: "hello world",
        },
      },
      {
        seq: 2,
        event: {
          kind: "tool_start",
          toolCallId: "tc1",
          toolName: "search",
        },
      },
      {
        seq: 3,
        event: {
          kind: "tool_end",
          toolCallId: "tc1",
          toolName: "search",
        },
      },
      { seq: 4, event: { kind: "text_end", messageId: "m1" } },
      { seq: 5, event: { kind: "finalize" } },
    ]);
  });

  it("preserves the 250 ms text boundary without submitting the terminal batch early", async () => {
    vi.useFakeTimers();
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createTerminalBatchingRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(sink.batches).toHaveLength(0);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " second" },
    });
    await renderer.finish?.();

    expect(sink.batches).toHaveLength(1);
    expect(
      sink.batches[0]?.frames
        .filter((frame) => frame.event.kind === "text_delta")
        .map((frame) => frame.event),
    ).toEqual([
      { kind: "text_delta", messageId: "m1", delta: "first" },
      { kind: "text_delta", messageId: "m1", delta: " second" },
    ]);
  });

  it.each([
    {
      name: "interrupt",
      drive: async (
        renderer: ReturnType<typeof createTerminalBatchingRenderer>["renderer"],
        subscriber: Subscriber,
      ) => {
        subscriber.onTextMessageContentEvent?.({
          event: { messageId: "m1", delta: "partial" },
        });
        await renderer.markInterrupted();
      },
      expected: ["run_started", "text_delta", "interrupt", "finalize"],
    },
    {
      name: "run_error",
      drive: async (
        renderer: ReturnType<typeof createTerminalBatchingRenderer>["renderer"],
        subscriber: Subscriber,
      ) => {
        subscriber.onRunErrorEvent?.({
          event: { message: "failed" },
        });
        await renderer.finish?.();
      },
      expected: ["run_started", "run_error", "finalize"],
    },
  ])(
    "submits one complete ordered terminal history for $name",
    async ({ drive, expected }) => {
      const sink = new RecordingBatchSink();
      const { renderer, subscriber } = createTerminalBatchingRenderer(sink);

      await drive(renderer, subscriber);

      expect(sink.batches).toHaveLength(1);
      expect(sink.batches[0]?.frames.map((frame) => frame.event.kind)).toEqual(
        expected,
      );
    },
  );

  it("flushes the buffered prefix before an explicit effect and streams the rest contiguously", async () => {
    const sink = new RecordingBatchSink();
    const { adapter, renderer, subscriber } =
      createTerminalBatchingRenderer(sink);
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "before" },
    });
    await adapter.post(target, card);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " after" },
    });
    subscriber.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    await settle();

    expect(
      sink.batches.map((batch) =>
        batch.frames.map((frame) => frame.event.kind),
      ),
    ).toEqual([
      ["run_started", "text_delta"],
      ["post"],
      ["text_delta", "text_end"],
    ]);
    expect(
      sink.batches.flatMap((batch) => batch.frames.map((frame) => frame.seq)),
    ).toEqual([0, 1, 2, 3, 4]);

    await renderer.finish?.();
    expect(sink.batches.at(-1)?.frames).toEqual([
      { seq: 5, event: { kind: "finalize" } },
    ]);
  });

  it("flushes a full 64-frame prefix and permanently falls back to streaming", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createTerminalBatchingRenderer(sink);

    for (let index = 0; index < 64; index += 1) {
      subscriber.onToolCallStartEvent?.({
        event: { toolCallId: `tc${index}`, toolCallName: "search" },
      });
    }
    await settle();

    expect(sink.batches.map((batch) => batch.frames.length)).toEqual([64, 1]);
    subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "tc64", toolCallName: "search" },
    });
    await settle();
    expect(sink.batches.map((batch) => batch.frames.length)).toEqual([
      64, 1, 1,
    ]);

    await renderer.finish?.();
  });

  it("flushes a byte-bounded prefix and permanently falls back to streaming", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createTerminalBatchingRenderer(sink);
    const largeToolName = "x".repeat(40 * 1024);

    for (let index = 0; index < 3; index += 1) {
      subscriber.onToolCallStartEvent?.({
        event: { toolCallId: `tc${index}`, toolCallName: largeToolName },
      });
    }
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "x".repeat(16 * 1024) },
    });
    await settle();

    expect(sink.batches.map((batch) => batch.frames.length)).toEqual([4, 1]);
    subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "tc4", toolCallName: "small" },
    });
    await settle();
    expect(sink.batches.map((batch) => batch.frames.length)).toEqual([4, 1, 1]);

    await renderer.finish?.();
  });

  it("flushes later adjacent text at a deterministic delta count and before a semantic boundary", async () => {
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    await settle();
    for (let index = 0; index < 255; index += 1) {
      subscriber.onTextMessageContentEvent?.({
        event: { messageId: "m1", delta: ` ${index}` },
      });
    }
    await settle();
    expect(sink.batches).toHaveLength(2);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " 255" },
    });
    await settle();
    expect(sink.batches).toHaveLength(3);

    subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    });
    await settle();

    expect(sink.batches).toHaveLength(4);
    expect(sink.batches[2]?.frames[0]?.event.kind).toBe("text_delta");
    expect(sink.batches[3]?.frames).toEqual([
      { seq: 3, event: { kind: "text_end", messageId: "m1" } },
    ]);
    await renderer.finish?.();
  });

  it("flushes a paced text tail after 250 ms without waiting for text_end", async () => {
    vi.useFakeTimers();
    const sink = new RecordingBatchSink();
    const { renderer, subscriber } = createRenderer(sink);

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " second" },
    });
    await settle();
    expect(sink.batches).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(249);
    expect(sink.batches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(sink.batches[2]?.frames).toEqual([
      {
        seq: 2,
        event: {
          kind: "text_delta",
          messageId: "m1",
          delta: " second",
        },
      },
    ]);
    await renderer.finish?.();
  });

  it("keeps equal 20-delta and 200-delta answers within 10% modeled acceptance latency", async () => {
    vi.useFakeTimers();

    const run = async (
      count: number,
    ): Promise<{ batches: number; modeledAcceptanceMs: number }> => {
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
      return {
        batches: sink.batches.length,
        modeledAcceptanceMs: sink.batches.length * 50,
      };
    };

    const twenty = await run(20);
    const twoHundred = await run(200);

    expect(Math.abs(twenty.batches - twoHundred.batches)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs(twenty.modeledAcceptanceMs - twoHundred.modeledAcceptanceMs) /
        Math.max(twenty.modeledAcceptanceMs, 1),
    ).toBeLessThanOrEqual(0.1);
  });

  it("keeps one batch in flight while later batches wait in order", async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sink: RenderEventSink = {
      pushBatch: async (batch) => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (calls === 1) await first;
        active -= 1;
        return {
          batchId: batch.batchId,
          egressOperationId: "eop_serial",
          acceptedThroughSeq: batch.endSeq,
          duplicate: false,
        };
      },
    };
    const { renderer, subscriber } = createRenderer(sink);
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    subscriber.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m2", delta: "second" },
    });
    await settle();

    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    const finishing = renderer.finish?.();
    releaseFirst?.();
    await finishing;
    expect(calls).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
  });

  it("keeps a concurrent discrete post behind the active renderer batch", async () => {
    const batches: AcceptedBatch[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstPush = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sink: RenderEventSink = {
      pushBatch: async (batch) => {
        batches.push(batch);
        if (batches.length === 1) await firstPush;
        return {
          batchId: batch.batchId,
          egressOperationId: "eop_shared_lane",
          acceptedThroughSeq: batch.endSeq,
          duplicate: false,
        };
      },
    };
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink: sink,
    });
    const renderer = adapter.createRunRenderer(target);
    const subscriber = renderer.subscriber as unknown as Subscriber;
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    });
    await settle();
    const posting = adapter.post(target, card);
    await settle();

    expect(batches).toHaveLength(1);
    releaseFirst?.();
    await posting;
    await renderer.finish?.();
    expect(batches.map((batch) => batch.startSeq)).toEqual([0, 1, 2, 3]);
  });

  it("flushes buffered text before a concurrent discrete post", async () => {
    const sink = new RecordingBatchSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink: sink,
    });
    const renderer = adapter.createRunRenderer(target);
    const subscriber = renderer.subscriber as unknown as Subscriber;
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: " second" },
    });
    await adapter.post(target, card);
    await renderer.finish?.();

    expect(
      sink.batches.flatMap((batch) =>
        batch.frames.map((frame) =>
          frame.event.kind === "text_delta"
            ? `${frame.event.kind}:${frame.event.delta}`
            : frame.event.kind,
        ),
      ),
    ).toEqual([
      "run_started",
      "text_delta:first",
      "text_delta: second",
      "post",
      "finalize",
    ]);
  });

  it("keeps every concurrent renderer on one ordered turn lane before an effect", async () => {
    const sink = new RecordingBatchSink();
    const adapter = intelligenceAdapterInternal(
      {
        source: new InMemoryDeliverySource(),
        egress: new InMemoryEgressSink(),
        renderSink: sink,
      },
      { terminalBatchingEnabled: true },
    );
    const first = adapter.createRunRenderer(target);
    const second = adapter.createRunRenderer(target);
    const firstSubscriber = first.subscriber as unknown as Subscriber;
    const secondSubscriber = second.subscriber as unknown as Subscriber;
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    firstSubscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "first" },
    });
    secondSubscriber.onTextMessageContentEvent?.({
      event: { messageId: "m2", delta: "second" },
    });
    await adapter.post(target, card);
    await first.finish?.();
    await second.finish?.();

    const frames = sink.batches.flatMap((batch) => batch.frames);
    expect(
      frames.map((frame) =>
        frame.event.kind === "text_delta"
          ? `${frame.event.kind}:${frame.event.delta}`
          : frame.event.kind,
      ),
    ).toEqual([
      "run_started",
      "text_delta:first",
      "run_started",
      "text_delta:second",
      "post",
      "finalize",
      "finalize",
    ]);
    expect(frames.map((frame) => frame.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("fails the lane with a stable bounded-memory error while transport is stalled", async () => {
    const sink: RenderEventSink = {
      pushBatch: async () => new Promise(() => undefined),
    };
    const { renderer, subscriber } = createRenderer(sink);
    const chunk = "x".repeat(16 * 1024);

    for (let index = 0; index < 24; index += 1) {
      subscriber.onTextMessageContentEvent?.({
        event: { messageId: `m${index}`, delta: chunk },
      });
    }

    await expect(renderer.finish?.()).rejects.toThrow(
      /CHANNEL_RENDER_LANE_OVERLOAD: turn turn_dlv_batch exceeded 262144 pending bytes/,
    );
  });
});
