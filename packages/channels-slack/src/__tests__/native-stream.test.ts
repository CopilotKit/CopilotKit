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
  /**
   * Slack's *cumulative* per-message text cap, in UTF-8 BYTES. An `appendStream`
   * whose delta would push the message's total `markdown_text` past this is
   * rejected with `msg_too_long` — what the real API does, and what a long reply
   * (a novella) hits in production. Bytes rather than chars because the incident
   * datapoint was English (1:1) and cannot distinguish the units, so the fake
   * models the stricter reading. Undefined = uncapped.
   */
  messageByteLimit?: number;
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
      if (opts?.failAppend) throw new Error("appendStream unavailable");
      const message = messages.find((m) => m.ts === ts);
      if (!message) throw new Error(`appendText to unknown ts ${ts}`);
      if (opts?.messageByteLimit !== undefined) {
        const bytes = (t: string) => new TextEncoder().encode(t).length;
        const posted = message.events.reduce(
          (n, e) => (e.kind === "text" ? n + bytes(e.value) : n),
          0,
        );
        if (posted + bytes(md) > opts.messageByteLimit) {
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

  it("keeps a reply that fits under the per-message cap in ONE message", async () => {
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // Just under the 11k soft limit, so this pins the boundary rather than
    // passing merely because it is far away from it.
    const text = "x".repeat(10_900);
    stream.append(text);
    await stream.finish();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.stopped).toBe(true);
    expect(textOf(messages[0]!.events)).toBe(text);
  });

  it("rolls over to continuation messages when the reply exceeds Slack's cumulative per-message cap", async () => {
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
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
      messageByteLimit: 12_000,
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

  it("rolls over on a non-Latin reply, where bytes and chars diverge", async () => {
    // The regression this guards: a char-based budget never fires under a
    // byte-denominated cap, so a CJK reply (3 bytes/char) silently truncated at
    // ~4k of 20k chars with zero rollovers — the original bug, intact, for every
    // non-Latin-script user. The incident datapoint was English (1:1 bytes:chars)
    // and so could not distinguish the units.
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const text = "漢字".repeat(10_000); // 20k chars / 60k UTF-8 bytes
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    const bytes = (t: string) => new TextEncoder().encode(t).length;
    for (const m of messages) {
      expect(bytes(textOf(m.events))).toBeLessThanOrEqual(12_000);
    }
  });

  it("delivers the tail when a continuation stream cannot be opened at finish()", async () => {
    // `finish()` enqueues exactly one flush, so a continuation `startStream` that
    // throws there has no later flush to retry it: the tail was dropped while the
    // first message finalized cleanly, making the turn look successful.
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    let tail = "";
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("transient 5xx");
        messages.push({ ts: "S1", text: "" });
        return "S1";
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        const m = messages.find((x) => x.ts === ts);
        if (!m) throw new Error(`unknown ts ${ts}`);
        m.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: () => ({
        append(full: string) {
          tail = full;
        },
        async finish() {},
      }),
      minIntervalMs: 0,
    });

    const text = "word ".repeat(5_000);
    stream.append(text);
    await stream.finish();

    // Nothing lost, and the tail carries ONLY what didn't stream natively — the
    // legacy sink must not be seeded with the whole buffer or the reply doubles.
    const native = messages.map((m) => m.text).join("");
    expect(native + tail).toBe(text);
    expect(native.length).toBeGreaterThan(0);
    expect(tail.length).toBeGreaterThan(0);
  });

  it("re-emits a table's header and delimiter in the continuation", async () => {
    // `detectOpenContext` models fences/inline-code/emphasis but not tables, so a
    // straddling table lost its header and rendered as literal pipes — in the very
    // feature (native `markdown_text` tables) that motivated this transport.
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const header = "| col a | col b |\n| --- | --- |\n";
    const rows = Array.from(
      { length: 700 },
      (_, i) => `| row ${i} value | another value here |`,
    ).join("\n");
    stream.append(header + rows);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages.slice(1)) {
      expect(textOf(m.events)).toContain("| --- |");
      expect(textOf(m.events).startsWith("| col a | col b |")).toBe(true);
    }
  });

  it("keeps one message when the whole reply fits the configured byte limit", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 40_000,
    });

    const text = "x".repeat(30_000);
    stream.append(text);
    await stream.finish();

    // One message, but split across several ≤12k appends.
    expect(messages).toHaveLength(1);
    const appends = messages[0]!.events.filter((e) => e.kind === "text");
    expect(appends.length).toBeGreaterThan(2);
    for (const a of appends) expect(a.value.length).toBeLessThanOrEqual(12_000);
    expect(textOf(messages[0]!.events)).toBe(text);
  });

  it("keeps filling a message when the per-call cap bites before the byte budget", async () => {
    // The `callEnd < byteEnd` branch: room for more than one call's worth, so the
    // append is capped by the 12k-per-call limit and the message is NOT rolled
    // over. Needs a configured budget above 12k *bytes of the text at hand*, which
    // multi-byte text reaches sooner. Also drives the "not even one code point
    // fits" branch, when the leftover room is smaller than the next character.
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 36_004,
    });

    const text = "漢".repeat(20_000); // 60k UTF-8 bytes, 3 bytes/char
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    for (const m of messages) {
      // Budget honoured per message, and per-call cap honoured per append.
      expect(
        new TextEncoder().encode(textOf(m.events)).length,
      ).toBeLessThanOrEqual(36_004);
      for (const e of m.events) {
        if (e.kind === "text")
          expect(e.value.length).toBeLessThanOrEqual(12_000);
      }
    }
  });

  it("degrades chunks when the continuation behind a rollover cannot be opened", async () => {
    // A rollover retargets the stream; if the continuation cannot be opened, the
    // chunk has no message to address and must degrade rather than throw at an
    // undefined ts. (Reaches flushChunk's catch via `ensureStarted`; the
    // `!this.curTs` re-check below it is a belt-and-braces guard — see the note
    // on defensive branches in the source.)
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const onChunkFailure = vi.fn();
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("continuation unavailable");
        messages.push({ ts: "S1", text: "" });
        return "S1";
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      onChunkFailure,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    stream.append("word ".repeat(200));
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Using `search`",
      status: "in_progress",
    });
    await stream.finish();

    expect(onChunkFailure).toHaveBeenCalled();
    expect(transport.appendChunks).not.toHaveBeenCalled();
  });

  it("keeps rolling over when the rollover's own stopStream fails", async () => {
    const { transport, messages } = makeFakeTransport({ failStop: true });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    const text = "word ".repeat(300);
    stream.append(text);
    await stream.finish();

    // Non-strict: a message left rendering as "still streaming" is cosmetic, so
    // the rollover proceeds and no text is lost.
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
  });

  it("strict mode reports the closer failure, not the stop failure, when both fail", async () => {
    // Precedence mirrors `finish()`: the earliest error wins, so a caller sees the
    // cause rather than the consequence.
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        messages.push({ ts: `S${starts}`, text: "" });
        return `S${starts}`;
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        if (/^[\n`*_~]+$/.test(md)) throw new Error("closer rejected");
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {
        throw new Error("stopStream unavailable");
      }),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      strict: true,
      minIntervalMs: 0,
    });

    stream.append("```python\n" + "print('x')\n".repeat(3_400));
    await expect(stream.finish()).rejects.toThrow("closer rejected");
  });

  it("rolls over even when the boundary closer is rejected", async () => {
    // The closer sits closest to the cap by construction (the message has just
    // filled), so it is the first append a wrong headroom assumption rejects.
    // Unguarded, it threw out of rollOver with curTs still set, so every later
    // flush re-entered rollOver and failed on the same closer — the rollover
    // switched itself off and 70% of the reply was lost.
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        messages.push({ ts: `S${starts}`, text: "" });
        return `S${starts}`;
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        // Reject a delta made only of markdown closers.
        if (/^[\n`*_~]+$/.test(md)) throw new Error("msg_too_long");
        const m = messages.find((x) => x.ts === ts);
        if (!m) throw new Error(`unknown ts ${ts}`);
        m.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    // Inside an open fence, so a closer is generated at every boundary.
    const text = "```python\n" + "print('x')\n".repeat(3_400);
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => m.text).join("")).toContain(
      "print('x')\n".repeat(100),
    );
    // Every char of the reply still delivered, closer or no closer.
    const delivered = messages.map((m) => m.text).join("");
    expect(delivered.length).toBeGreaterThanOrEqual(text.length);
  });

  it("re-opens with a bare fence when the language tag is implausibly long", async () => {
    // `detectOpenContext` calls everything up to the first newline after ``` the
    // "language", so a minified blob became a multi-kilobyte preamble re-injected
    // into every continuation, roughly halving useful throughput.
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const blob = "j".repeat(5_000);
    stream.append("```" + blob + "\n" + "code line here\n".repeat(2_000));
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    // Continuations re-open the fence, but bare — no blob.
    for (const m of messages.slice(1)) {
      const rendered = textOf(m.events);
      expect(rendered.startsWith("```\n")).toBe(true);
      expect(rendered).not.toContain(blob);
    }
  });

  it("bounds the number of messages one reply may occupy", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      maxMessages: 5,
    });

    stream.append("word ".repeat(100_000)); // 500k chars
    await stream.finish();

    // Capped, and the cut is visible rather than silent.
    expect(messages).toHaveLength(5);
    expect(textOf(messages[4]!.events)).toContain("reply truncated");
  });

  it("marks a truncated reply exactly once, however much text keeps arriving", async () => {
    // `truncate()` was not terminal: text keeps arriving after the cap, so
    // `append()` grew the buffer, the next flush saw undelivered text on an
    // already-full message, and re-entered — stacking one marker per flush (36 at
    // production defaults) and pushing the last message past its own budget,
    // since this was the one append path that never charged `curMessageBytes`.
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      maxMessages: 3,
    });

    // Arrives incrementally, well past what 3 messages can hold.
    const text = "word ".repeat(20_000);
    for (let i = 5_000; i <= text.length; i += 5_000) {
      stream.append(text.slice(0, i));
      await new Promise((r) => setTimeout(r, 0));
    }
    await stream.finish();

    expect(messages).toHaveLength(3);
    const last = textOf(messages[2]!.events);
    expect(last.match(/reply truncated/g) ?? []).toHaveLength(1);
    // The marker is charged like every other append, so the fake's cumulative
    // cap is never breached — no wasted `msg_too_long` calls after the cut.
    expect(new TextEncoder().encode(last).length).toBeLessThanOrEqual(12_000);
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
      messageByteLimit: 1001,
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
      messageByteLimit: 12_000,
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

  it("strict mode surfaces a rollover closer failure, after still finalizing", async () => {
    // Rollover was added after `strict`, so its own guards have to honour it:
    // non-strict keeps going (degraded markdown beats a lost reply), strict makes
    // the failure visible — but either way `stopStream` is reached, so no native
    // stream is left open.
    const messages: { ts: string; text: string; stopped: boolean }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        messages.push({ ts: `S${starts}`, text: "", stopped: false });
        return `S${starts}`;
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        if (/^[\n`*_~]+$/.test(md)) throw new Error("closer rejected");
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async (ts: string) => {
        messages.find((m) => m.ts === ts)!.stopped = true;
      }),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      strict: true,
      minIntervalMs: 0,
    });

    stream.append("```python\n" + "print('x')\n".repeat(3_400));
    await expect(stream.finish()).rejects.toThrow("closer rejected");
    // The message that hit the boundary was still finalized.
    expect(messages[0]!.stopped).toBe(true);
  });

  it("strict mode surfaces an undelivered tail instead of using the legacy fallback", async () => {
    // Non-strict hands the tail to the legacy sink; strict disables that fallback
    // by design, so the loss must be reported rather than quietly routed around.
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const fallback = makeFakeFallback();
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("continuation unavailable");
        messages.push({ ts: "S1", text: "" });
        return "S1";
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: () => fallback,
      strict: true,
      minIntervalMs: 0,
    });

    stream.append("word ".repeat(5_000));
    await expect(stream.finish()).rejects.toThrow("continuation unavailable");
    // The legacy transport was never engaged.
    expect(fallback.last()).toBe("");
    expect(fallback.finished).toBe(false);
  });

  it("rolls over on 2-byte-per-char text (Cyrillic)", async () => {
    // The byte budget's third width class. CJK covers 3-byte and emoji 4-byte;
    // Cyrillic/Greek/Hebrew/Arabic are 2-byte, and are the scripts that break
    // soonest under a char-denominated budget after CJK.
    const { transport, messages } = makeFakeTransport({
      messageByteLimit: 12_000,
    });
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
    });

    const text = "привет ".repeat(2_000); // 14k chars / 26k UTF-8 bytes
    stream.append(text);
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.map((m) => textOf(m.events)).join("")).toBe(text);
    for (const m of messages) {
      expect(
        new TextEncoder().encode(textOf(m.events)).length,
      ).toBeLessThanOrEqual(12_000);
    }
  });

  it("closes and re-opens emphasis straddling a boundary", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    stream.append("**" + "word ".repeat(200));
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    // Outgoing message closes the bold run; the continuation re-opens it.
    expect(textOf(messages[0]!.events).endsWith("**")).toBe(true);
    expect(textOf(messages[1]!.events).startsWith("**")).toBe(true);
  });

  it("closes and re-opens an inline-code span straddling a boundary", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    stream.append("`" + "code ".repeat(200));
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    expect(textOf(messages[0]!.events).endsWith("`")).toBe(true);
    expect(textOf(messages[1]!.events).startsWith("`")).toBe(true);
  });

  it("does not close a fence that has only just opened", async () => {
    // Mirrors `hasFenceCodeContent`: ```lang with no body yet must not be closed,
    // or the boundary emits an empty code block and immediately re-opens it.
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      // Small enough that the first boundary lands exactly on the fence's newline.
      messageByteLimit: 10,
    });

    stream.append("```py\n" + "x".repeat(60));
    await stream.finish();

    expect(textOf(messages[0]!.events)).toBe("```py\n");
  });

  it("does not re-emit a table header once the table has ended", async () => {
    const { transport, messages } = makeFakeTransport();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    // Table, then prose in the same block. A boundary in the prose is no longer
    // "inside the rows", so re-emitting the header would inject a stray table.
    stream.append(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\nPlain prose follows. " +
        "word ".repeat(200),
    );
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages.slice(1)) {
      expect(textOf(m.events)).not.toContain("| --- |");
    }
  });

  it("sends a structured chunk to the message current after a rollover", async () => {
    const { transport, messages } = makeFakeTransport();
    const onChunkFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      onChunkFailure,
      minIntervalMs: 0,
      messageByteLimit: 400,
    });

    stream.append("word ".repeat(300));
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Using `search`",
      status: "in_progress",
    });
    await stream.finish();

    expect(messages.length).toBeGreaterThan(1);
    // The chunk lands on the message that was open when it was flushed, not the
    // first one, and the rollover does not degrade chunk support.
    expect(onChunkFailure).not.toHaveBeenCalled();
    const withChunk = messages.filter((m) =>
      m.events.some((e) => e.kind === "chunks"),
    );
    expect(withChunk).toHaveLength(1);
    expect(withChunk[0]!.ts).toBe(messages[messages.length - 1]!.ts);
  });

  it("does not fail the turn when the truncation marker cannot be posted", async () => {
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        messages.push({ ts: `S${starts}`, text: "" });
        return `S${starts}`;
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        if (md.includes("reply truncated")) throw new Error("msg_too_long");
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      minIntervalMs: 0,
      maxMessages: 2,
      messageByteLimit: 400,
    });

    stream.append("word ".repeat(500));
    // Non-strict: a failed marker is logged, never thrown — the reply is already
    // truncated, and failing the turn here would be worse than an unmarked cut.
    await expect(stream.finish()).resolves.toBeUndefined();
    expect(messages).toHaveLength(2);
  });

  it("strict mode reports a failed truncation marker", async () => {
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        messages.push({ ts: `S${starts}`, text: "" });
        return `S${starts}`;
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        if (md.includes("reply truncated")) throw new Error("marker rejected");
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      strict: true,
      minIntervalMs: 0,
      maxMessages: 2,
      messageByteLimit: 400,
    });

    stream.append("word ".repeat(500));
    await expect(stream.finish()).rejects.toThrow("marker rejected");
  });

  it("skips a queued chunk when a strict text failure rejects the queue", async () => {
    // Flushes share one promise chain, and `.then()` on a rejected promise skips
    // its callback — so a strict text failure means the queued `flushChunk` never
    // runs at all. The chunk is dropped rather than posted to a stream the caller
    // is about to be told failed, and `onChunkFailure` stays silent because the
    // text path already reports it.
    const { transport } = makeFakeTransport({ failAppend: true });
    const onChunkFailure = vi.fn();
    const stream = new NativeMessageStream({
      transport,
      fallback: makeFakeFallback,
      onChunkFailure,
      strict: true,
      minIntervalMs: 0,
    });

    stream.append("hello");
    stream.appendChunk({
      type: "task_update",
      id: "t1",
      title: "Using `search`",
      status: "in_progress",
    });
    await expect(stream.finish()).rejects.toThrow("appendStream unavailable");
    expect(transport.appendChunks).not.toHaveBeenCalled();
    expect(onChunkFailure).not.toHaveBeenCalled();
  });

  it("survives a legacy tail fallback that itself fails", async () => {
    const messages: { ts: string; text: string }[] = [];
    let starts = 0;
    const transport: NativeStreamTransport = {
      startStream: vi.fn(async () => {
        starts++;
        if (starts > 1) throw new Error("continuation unavailable");
        messages.push({ ts: "S1", text: "" });
        return "S1";
      }),
      appendText: vi.fn(async (ts: string, md: string) => {
        messages.find((m) => m.ts === ts)!.text += md;
      }),
      appendChunks: vi.fn(async () => {}),
      stopStream: vi.fn(async () => {}),
    };
    const stream = new NativeMessageStream({
      transport,
      fallback: () => ({
        append() {},
        finish: async () => {
          throw new Error("legacy unavailable");
        },
      }),
      minIntervalMs: 0,
    });

    stream.append("word ".repeat(5_000));
    // Both transports failed; the turn still completes rather than rejecting from
    // a best-effort last resort.
    await expect(stream.finish()).resolves.toBeUndefined();
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
