import { describe, it, expect, vi } from "vitest";
import { NativeMessageStream } from "../native-stream.js";
import type { NativeStreamTransport, TextStream } from "../native-stream.js";

/**
 * A fake `chat.startStream/appendStream/stopStream` transport that records the
 * lifecycle of every streamed message in order, so tests can assert the
 * concatenated deltas, the message splits, and the stop calls.
 */
function makeFakeTransport(opts?: {
  failStart?: boolean;
  failStartAfter?: number;
}) {
  const messages: {
    ts: string;
    appends: string[];
    stopped: boolean;
    discarded: boolean;
  }[] = [];
  let counter = 0;
  const transport: NativeStreamTransport = {
    startStream: vi.fn(async () => {
      if (opts?.failStart) throw new Error("startStream unavailable");
      // Succeed for the first `failStartAfter` starts, then fail (simulates a
      // continuation start failing after the first message already streamed).
      if (
        opts?.failStartAfter !== undefined &&
        counter >= opts.failStartAfter
      ) {
        throw new Error("startStream unavailable (continuation)");
      }
      counter++;
      const ts = `S${counter}`;
      messages.push({ ts, appends: [], stopped: false, discarded: false });
      return ts;
    }),
    appendStream: vi.fn(async (ts: string, md: string) => {
      messages.find((m) => m.ts === ts)?.appends.push(md);
    }),
    stopStream: vi.fn(async (ts: string) => {
      const m = messages.find((x) => x.ts === ts);
      if (m) m.stopped = true;
    }),
    discardStream: vi.fn(async (ts: string) => {
      const m = messages.find((x) => x.ts === ts);
      if (m) m.discarded = true;
    }),
  };
  return { transport, messages };
}

/** A legacy fallback sink that just records the accumulated text it sees. */
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
    // The concatenated deltas reconstruct the final buffer exactly.
    expect(messages[0]!.appends.join("")).toBe("ALPHA");
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

  it("prime() opens the stream eagerly; a later append reuses it (one start)", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    await stream.prime();
    expect(transport.startStream).toHaveBeenCalledTimes(1);
    expect(transport.appendStream).not.toHaveBeenCalled();
    expect(stream.firstTs).toBe("S1");

    stream.append("hello");
    await stream.finish();

    // Still exactly one stream — the eager bubble was reused, not reopened.
    expect(transport.startStream).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.appends.join("")).toBe("hello");
    expect(messages[0]!.stopped).toBe(true);
    expect(messages[0]!.discarded).toBe(false);
  });

  it("prime() then finish() with no content discards the empty bubble", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    await stream.prime();
    await stream.finish();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.discarded).toBe(true);
    expect(messages[0]!.stopped).toBe(false);
  });

  it("prime() falls back to stopStream for an empty bubble when discardStream is absent", async () => {
    const { transport, messages } = makeFakeTransport();
    // Strip discardStream — older/partial transports may not implement it.
    delete (transport as { discardStream?: unknown }).discardStream;
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    await stream.prime();
    await stream.finish();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.stopped).toBe(true);
  });

  it("prime() failover to legacy never throws", async () => {
    const { transport } = makeFakeTransport({ failStart: true });
    const fallback = makeFakeFallback();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      minIntervalMs: 0,
    });

    // Priming a workspace where startStream is unavailable must not throw.
    await expect(stream.prime()).resolves.toBeUndefined();

    // Subsequent content flows through the legacy fallback.
    stream.append("via legacy");
    await stream.finish();
    expect(fallback.last()).toBe("via legacy");
    expect(fallback.finished).toBe(true);
  });

  it("opens a continuation message when the budget is exceeded", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageBudget: 10,
    });

    // 3 lines, each under the budget alone, but together over it.
    const text = "line one\nline two\nline three";
    stream.append(text);
    await stream.finish();

    // More than one streamed message, each finalized.
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((m) => m.stopped)).toBe(true);
    // The visible text (continuation openers are empty for plain text) equals
    // the original — no content lost across the split.
    expect(messages.map((m) => m.appends.join("")).join("")).toBe(text);
  });

  it("re-opens an unclosed code fence on the continuation message", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageBudget: 16,
    });

    // A fence that opens before the split boundary and stays open across it.
    const text = "```py\nprint(1)\nprint(2)\nprint(3)\n";
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    // The continuation message must begin by re-opening the python fence so it
    // renders as code rather than plain text.
    expect(messages[1]!.appends[0]).toMatch(/^```py\n/);
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
    expect(transport.appendStream).not.toHaveBeenCalled();
    // The accumulated buffer was replayed into the legacy transport.
    expect(fallback.last()).toBe("hello world");
    expect(fallback.finished).toBe(true);
  });

  it("fails over to legacy (no text lost) when a CONTINUATION startStream fails", async () => {
    // First message streams natively; the second (continuation) startStream
    // fails — the remainder must not be appended to the stopped first message
    // and must reach the legacy fallback instead.
    const { transport, messages } = makeFakeTransport({ failStartAfter: 1 });
    const fallback = makeFakeFallback();
    const onStartFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      onStartFailure,
      minIntervalMs: 0,
      messageBudget: 10,
    });

    const text = "line one\nline two\nline three"; // forces a continuation
    stream.append(text);
    await stream.finish();

    expect(onStartFailure).toHaveBeenCalledTimes(1);
    // Exactly one native message was opened (and finalized) before the failure.
    expect(messages).toHaveLength(1);
    expect(messages[0]!.stopped).toBe(true);
    // The full response was replayed into the legacy transport — nothing lost.
    expect(fallback.last()).toBe(text);
    expect(fallback.finished).toBe(true);
  });
});
