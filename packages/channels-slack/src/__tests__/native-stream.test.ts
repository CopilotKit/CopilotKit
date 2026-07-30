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
  /**
   * Slack's *cumulative* per-message text cap. An `appendStream` whose delta
   * would push the message's total `markdown_text` past this many chars is
   * rejected with `msg_too_long` — exactly what the real API does, and what a
   * long reply (a novella) hits in production. Undefined = uncapped.
   */
  messageCharLimit?: number;
  /**
   * Hard ceiling on `startStream` calls. Turns a runaway rollover loop into a
   * failed test instead of a hung one (and, in production, unbounded messages).
   */
  startBudget?: number;
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
      if (opts?.startBudget !== undefined && counter > opts.startBudget) {
        throw new Error(`RUNAWAY: ${counter} startStream calls`);
      }
      const ts = `S${counter}`;
      messages.push({ ts, events: [], stopped: false });
      return ts;
    }),
    appendText: vi.fn(async (ts: string, md: string) => {
      const message = messages.find((m) => m.ts === ts);
      if (!message) throw new Error(`appendText to unknown ts ${ts}`);
      if (opts?.messageCharLimit !== undefined) {
        const posted = message.events.reduce(
          (n, e) => (e.kind === "text" ? n + e.value.length : n),
          0,
        );
        if (posted + md.length > opts.messageCharLimit) {
          throw new Error("msg_too_long");
        }
      }
      message.events.push({ kind: "text", value: md });
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

  it("keeps a reply that fits under the per-message cap in ONE message", async () => {
    const { transport, messages } = makeFakeTransport({
      messageCharLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const text = "x".repeat(5_000);
    stream.append(text);
    await stream.finish();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.stopped).toBe(true);
    expect(textOf(messages[0]!.events)).toBe(text);
  });

  it("rolls over to continuation messages when the reply exceeds Slack's cumulative per-message cap", async () => {
    const { transport, messages } = makeFakeTransport({
      messageCharLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // A novella-length reply: ~2× Slack's cumulative per-message cap. The
    // production incident lost 4 of 5 attempts to `msg_too_long` here.
    const text = "x".repeat(25_000);
    stream.append(text);
    await stream.finish();

    // Split across messages, none of which exceeded the cumulative cap...
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) {
      expect(textOf(m.events).length).toBeLessThanOrEqual(12_000);
      // ...every append still under the 12k per-call cap...
      for (const e of m.events) {
        if (e.kind === "text")
          expect(e.value.length).toBeLessThanOrEqual(12_000);
      }
      // ...and every message finalized, not left streaming.
      expect(m.stopped).toBe(true);
    }
    // Not one character lost or reordered.
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    // The MessageRef still points at the first message of the reply.
    expect(stream.firstTs).toBe("S1");
  });

  it("rolls over at a line boundary instead of mid-word", async () => {
    const { transport, messages } = makeFakeTransport({
      messageCharLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // 250 numbered lines of ~100 chars — every line break is a legal boundary.
    const lines = Array.from({ length: 250 }, (_, i) =>
      `${String(i).padStart(4, "0")} ${"word ".repeat(19)}`.trim(),
    );
    const text = lines.join("\n");
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    // No message except the last may end mid-word: each boundary lands on a
    // newline, so no rendered line is ever torn in half.
    for (const m of messages.slice(0, -1)) {
      const rendered = textOf(m.events);
      expect(rendered.endsWith("\n")).toBe(true);
    }
  });

  it("terminates when the continuation re-opener is larger than the message cap", async () => {
    const { transport, messages } = makeFakeTransport({ startBudget: 30 });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // An unclosed fence whose "language line" is a ~20k whitespace-free blob
    // (minified JSON, base64, a long log line). `detectOpenContext` reports the
    // whole blob as the fence language, so the re-opener alone exceeds the
    // per-message cap. Re-injecting it every rollover would fill each fresh
    // message with its own preamble and never advance — unbounded messages.
    const text = "```" + "j".repeat(20_000);
    stream.append(text);
    await stream.finish();

    // Bounded message count, and every char still delivered.
    expect(messages.length).toBeLessThan(10);
    expect(messages.map((m) => textOf(m.events)).join("")).toContain(
      "j".repeat(1_000),
    );
    expect(
      messages.reduce((n, m) => n + textOf(m.events).length, 0),
    ).toBeGreaterThanOrEqual(text.length);
  });

  it("never splits a surrogate pair across a boundary", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      // Odd cap so the boundary lands mid-pair unless explicitly corrected.
      messageCharLimit: 1001,
      minIntervalMs: 0,
    });

    // Emoji are surrogate pairs and there is no whitespace to break on, so
    // every boundary is a hard cut through the middle of the text.
    const text = "\u{1F600}".repeat(2_000);
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) {
      const rendered = textOf(m.events);
      // A lone high surrogate at the end (or low at the start) is a broken glyph
      // in Slack, even though re-concatenating the messages looks correct.
      expect(/[\uD800-\uDBFF]$/.test(rendered)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(rendered)).toBe(false);
    }
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
  });

  it("resumes from the last successful append after a transient failure, never re-posting", async () => {
    const { transport, messages } = makeFakeTransport();
    // Reject the 2nd append once; the flush after it must resume from the same
    // offset rather than replaying text Slack already accepted.
    let calls = 0;
    const inner = transport.appendText;
    transport.appendText = vi.fn(async (ts: string, md: string) => {
      calls++;
      if (calls === 2) throw new Error("transient");
      return inner(ts, md);
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    stream.append("one ");
    await new Promise((r) => setTimeout(r, 0));
    stream.append("one two ");
    await new Promise((r) => setTimeout(r, 0));
    stream.append("one two three");
    await stream.finish();

    expect(textOf(messages[0]!.events)).toBe("one two three");
  });

  it("reopens an unclosed code fence in the continuation message", async () => {
    const { transport, messages } = makeFakeTransport({
      messageCharLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // A fenced block long enough to straddle the rollover boundary.
    const text = `here you go:\n\n\`\`\`python\n${"# a comment line\n".repeat(1_200)}\`\`\`\n`;
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    // The continuation must re-open the fence, or Slack renders the rest of the
    // program as prose.
    expect(textOf(messages[1]!.events).startsWith("```")).toBe(true);
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
