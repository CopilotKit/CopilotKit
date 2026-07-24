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
  failStart?: boolean;
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

  it("splits a long reply into continuation messages at the per-message budget", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // 25k of space-separated words (so clean word boundaries exist) > 2× budget.
    const text = "word ".repeat(5_000).trimEnd(); // 24_999 chars
    stream.append(text);
    await stream.finish();

    // Rolls over into 3 messages (12k + 12k + remainder), each finalized.
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(m.stopped).toBe(true);
    // No text is lost: concatenating every message reconstructs the reply.
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    // Each message stays within the 12k markdown budget.
    for (const m of messages) {
      expect(textOf(m.events).length).toBeLessThanOrEqual(12_000);
    }
    // Every individual append is also under the per-call cap.
    for (const m of messages) {
      for (const e of m.events) {
        if (e.kind === "text") expect(e.value.length).toBeLessThanOrEqual(12_000);
      }
    }
    expect(stream.firstTs).toBe("S1");
  });

  it("re-opens an open code fence at the start of a continuation message", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // A fenced code block that stays open well past the 12k budget, forcing a
    // split while inside the fence.
    const text = "intro\n```js\n" + "const x = 1;\n".repeat(1_500);
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThanOrEqual(2);
    // The continuation message's first text append re-opens the fence so it
    // renders as code standalone rather than leaking the raw source.
    expect(textOf(messages[1]!.events).startsWith("```")).toBe(true);
  });

  it("fails over to legacy with only the un-posted remainder when a continuation startStream fails", async () => {
    // First startStream succeeds; the continuation's startStream throws.
    let starts = 0;
    let native = ""; // text posted to the (only) native message
    let stopped = false;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("continuation startStream refused");
        return "S1";
      }),
      appendText: vi.fn(async (_ts: string, md: string) => {
        native += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {
        stopped = true;
      }),
    };
    const fallback = makeFakeFallback();
    const onStartFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      onStartFailure,
      minIntervalMs: 0,
    });

    const text = "word ".repeat(5_000).trimEnd(); // forces a continuation
    stream.append(text);
    // Let the first flush run (and fail over) before appending more, so the
    // post-failover forwarding path is exercised too.
    await new Promise((r) => setTimeout(r, 1));
    const finalText = `${text} plus a post-failover tail.`;
    stream.append(finalText);
    await stream.finish();

    expect(starts).toBe(2); // first + the failing continuation
    // The first start succeeded, so the workspace demonstrably supports native
    // streaming — a continuation blip must NOT downgrade it to legacy.
    expect(onStartFailure).not.toHaveBeenCalled();
    // The native message was finalized at the boundary and keeps its text; the
    // legacy stream carries ONLY the remainder — nothing dropped, nothing twice.
    expect(stopped).toBe(true);
    expect(native.length).toBeGreaterThan(0);
    expect(native + fallback.last()).toBe(finalText);
    expect(fallback.finished).toBe(true);
  });

  it("prepends the open-markdown opener to the legacy remainder on continuation failover", async () => {
    let starts = 0;
    let native = "";
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("continuation startStream refused");
        return "S1";
      }),
      appendText: vi.fn(async (_ts: string, md: string) => {
        native += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const fallback = makeFakeFallback();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      minIntervalMs: 0,
    });

    // A fence still open at the split point, so the legacy remainder needs a
    // re-opener to render as code standalone.
    const text = "intro\n```js\n" + "const x = 1;\n".repeat(1_500);
    stream.append(text);
    await stream.finish();

    expect(starts).toBe(2);
    expect(fallback.last().startsWith("```")).toBe(true);
    // Everything past the native boundary made it into the legacy stream.
    expect(fallback.last().endsWith(text.slice(native.length))).toBe(true);
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
