import { describe, it, expect, vi } from "vitest";
import { NativeMessageStream } from "../native-stream.js";
import type { NativeStreamTransport, TextStream } from "../native-stream.js";
import type { AnyChunk, KnownBlock } from "@slack/types";

type Event =
  | { kind: "text"; value: string }
  | { kind: "chunks"; value: AnyChunk[] };

/**
 * A fake `chat.startStream/appendStream/stopStream` transport that records the
 * lifecycle of every streamed message in order: text appends and chunk appends
 * interleaved, plus the stop call and any trailing blocks.
 */
function makeFakeTransport(opts?: {
  failAppend?: boolean;
  failStart?: boolean;
  failStop?: boolean;
  failChunks?: boolean;
}) {
  const messages: {
    ts: string;
    events: Event[];
    stopped: boolean;
    stopBlocks?: KnownBlock[];
  }[] = [];
  let counter = 0;
  const transport: NativeStreamTransport = {
    startStream: vi.fn(async () => {
      if (opts?.failStart) throw new Error("startStream unavailable");
      counter++;
      const ts = `S${counter}`;
      messages.push({ ts, events: [], stopped: false });
      return ts;
    }),
    appendText: vi.fn(async (ts: string, md: string) => {
      if (opts?.failAppend) throw new Error("appendStream unavailable");
      messages
        .find((m) => m.ts === ts)
        ?.events.push({ kind: "text", value: md });
    }),
    appendChunks: vi.fn(async (ts: string, chunks: AnyChunk[]) => {
      if (opts?.failChunks) throw new Error("chunks unsupported");
      messages
        .find((m) => m.ts === ts)
        ?.events.push({ kind: "chunks", value: chunks });
    }),
    stopStream: vi.fn(async (ts: string, blocks?: KnownBlock[]) => {
      if (opts?.failStop) throw new Error("stopStream unavailable");
      const m = messages.find((x) => x.ts === ts);
      if (m) {
        m.stopped = true;
        m.stopBlocks = blocks;
      }
    }),
  };
  return { transport, messages };
}

/** A legacy fallback sink that records the accumulated text it sees. */
function makeFakeFallback(): TextStream & {
  last: () => string;
  finished: boolean;
} {
  let buf = "";
  let finished = false;
  return {
    append(fullText: string) {
      buf = fullText;
    },
    async finish() {
      finished = true;
    },
    last: () => buf,
    get finished() {
      return finished;
    },
  };
}

const textOf = (events: Event[]): string =>
  events
    .filter((e): e is { kind: "text"; value: string } => e.kind === "text")
    .map((e) => e.value)
    .join("");

describe("NativeMessageStream", () => {
  it("starts one stream and appends only the deltas, in order", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    stream.append("A");
    stream.append("AL");
    stream.append("ALPHA");
    await stream.finish();

    expect(transport.startStream).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(textOf(messages[0]!.events)).toBe("ALPHA");
    expect(messages[0]!.stopped).toBe(true);
    expect(stream.firstTs).toBe("S1");
  });

  it("never starts a stream when nothing is appended", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });
    await stream.finish();
    expect(transport.startStream).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it("keeps a long reply in ONE message, chunking appends under the 12k per-call cap", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const text = "x".repeat(25_000); // > 2× the 12k per-append limit
    stream.append(text);
    await stream.finish();

    // One streamed message (no continuation splitting), finalized.
    expect(messages).toHaveLength(1);
    expect(messages[0]!.stopped).toBe(true);
    // Reconstructs exactly, and every append is <= 12k chars.
    const appends = messages[0]!.events.filter((e) => e.kind === "text");
    expect(appends.length).toBeGreaterThan(1);
    for (const a of appends) expect(a.value.length).toBeLessThanOrEqual(12_000);
    expect(textOf(messages[0]!.events)).toBe(text);
  });

  it("appendChunk flushes pending text FIRST, then sends the chunk", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    stream.append("hello");
    const chunk: AnyChunk = {
      type: "task_update",
      id: "t1",
      title: "Using `search`",
      status: "in_progress",
    };
    stream.appendChunk(chunk);
    await stream.finish();

    const events = messages[0]!.events;
    // Text "hello" must land before the chunk.
    const textIdx = events.findIndex((e) => e.kind === "text");
    const chunkIdx = events.findIndex((e) => e.kind === "chunks");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(chunkIdx).toBeGreaterThan(textIdx);
    expect((events[chunkIdx] as { value: AnyChunk[] }).value).toEqual([chunk]);
  });

  it("starts the stream when the first thing emitted is a chunk (no text yet)", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Using `search`",
      status: "in_progress",
    });
    await stream.finish();
    expect(transport.startStream).toHaveBeenCalledTimes(1);
    expect(messages[0]!.events[0]?.kind).toBe("chunks");
  });

  it("finish(blocks) finalizes the message carrying trailing blocks", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });
    stream.append("done");
    const blocks: KnownBlock[] = [
      { type: "context_actions", elements: [] } as unknown as KnownBlock,
    ];
    await stream.finish(blocks);
    expect(messages[0]!.stopped).toBe(true);
    expect(messages[0]!.stopBlocks).toBe(blocks);
  });

  it("falls back to the legacy transport when the first startStream fails", async () => {
    const { transport } = makeFakeTransport({ failStart: true });
    const fallback = makeFakeFallback();
    const onStartFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      onStartFailure,
      minIntervalMs: 0,
    });

    stream.append("hello");
    stream.append("hello world");
    await stream.finish();

    expect(onStartFailure).toHaveBeenCalledTimes(1);
    expect(transport.appendText).not.toHaveBeenCalled();
    expect(fallback.last()).toBe("hello world");
    expect(fallback.finished).toBe(true);
  });

  it("strict mode rejects a start failure without creating a legacy bubble", async () => {
    const { transport } = makeFakeTransport({ failStart: true });
    const fallback = makeFakeFallback();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      strict: true,
      minIntervalMs: 0,
    });

    stream.append("managed reply");

    await expect(stream.finish()).rejects.toThrow("startStream unavailable");
    expect(fallback.last()).toBe("");
    expect(fallback.finished).toBe(false);
  });

  it("strict mode reports append and stop failures to the caller", async () => {
    const appendFailure = makeFakeTransport({ failAppend: true });
    const appendStream = new NativeMessageStream({
      transport: appendFailure.transport,
      fallback: makeFakeFallback,
      strict: true,
      minIntervalMs: 0,
    });
    appendStream.append("managed reply");
    await expect(appendStream.finish()).rejects.toThrow(
      "appendStream unavailable",
    );
    // Even when a strict append fails, finish still finalizes the open stream.
    expect(appendFailure.messages[0]?.stopped).toBe(true);
    expect(appendFailure.transport.stopStream).toHaveBeenCalledOnce();

    const stopFailure = makeFakeTransport({ failStop: true });
    const stopStream = new NativeMessageStream({
      transport: stopFailure.transport,
      fallback: makeFakeFallback,
      strict: true,
      minIntervalMs: 0,
    });
    stopStream.append("managed reply");
    await expect(stopStream.finish()).rejects.toThrow("stopStream unavailable");
  });

  it("fires onChunkFailure and degrades when a chunk append fails", async () => {
    const { transport, messages } = makeFakeTransport({ failChunks: true });
    const onChunkFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      onChunkFailure,
      minIntervalMs: 0,
    });

    stream.append("text");
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Using `x`",
      status: "in_progress",
    });
    // A second chunk after the failure must NOT retry (chunks disabled).
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Used `x`",
      status: "complete",
    });
    await stream.finish();

    expect(onChunkFailure).toHaveBeenCalledTimes(1);
    // Text still streamed and the message finalized — degradation, not failure.
    expect(textOf(messages[0]!.events)).toBe("text");
    expect(messages[0]!.stopped).toBe(true);
  });

  it("appendChunk on an already-failed-over (legacy) stream fires onChunkFailure once, no-op", async () => {
    const { transport } = makeFakeTransport({ failStart: true });
    const onChunkFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      onChunkFailure,
      minIntervalMs: 0,
    });
    stream.append("hi");
    await stream.finish(); // triggers failover to legacy
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "x",
      status: "in_progress",
    });
    expect(onChunkFailure).toHaveBeenCalledTimes(1);
    expect(transport.appendChunks).not.toHaveBeenCalled();
  });
});
