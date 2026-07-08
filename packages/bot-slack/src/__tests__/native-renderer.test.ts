import { describe, it, expect, vi } from "vitest";
import type { AnyChunk, KnownBlock } from "@slack/types";
import { createRunRenderer } from "../event-renderer.js";
import type { NativeStreamTransport } from "../native-stream.js";
import type { SlackRenderTransport } from "../render/transport.js";

/** Fake render transport for the non-native side channels (legacy/error posts). */
function makeFakeClient() {
  const posts: {
    channel: string;
    thread_ts?: string;
    text: string;
    ts: string;
  }[] = [];
  const updates: { channel: string; ts: string; text: string }[] = [];
  let counter = 0;
  const transport: SlackRenderTransport = {
    setStatus: vi.fn(async () => {}),
    postMessage: vi.fn(
      async (args: { channel: string; thread_ts?: string; text: string }) => {
        counter++;
        const ts = `${counter}.000`;
        posts.push({ ...args, ts });
        return { ts };
      },
    ),
    updateMessage: vi.fn(
      async (args: { channel: string; ts: string; text: string }) => {
        updates.push(args);
      },
    ),
  };
  return { transport, posts, updates };
}

type Event =
  | { kind: "text"; value: string }
  | { kind: "chunks"; value: AnyChunk[] };

/** Fake native streaming transport recording every streamed message's lifecycle. */
function makeFakeNativeTransport(opts?: { failChunks?: boolean }) {
  const messages: {
    ts: string;
    events: Event[];
    stopped: boolean;
    stopBlocks?: KnownBlock[];
  }[] = [];
  let counter = 0;
  const transport: NativeStreamTransport = {
    startStream: vi.fn(async () => {
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

const textOf = (events: Event[]): string =>
  events
    .filter((e): e is { kind: "text"; value: string } => e.kind === "text")
    .map((e) => e.value)
    .join("");

const chunksOf = (events: Event[]): AnyChunk[] =>
  events
    .filter(
      (e): e is { kind: "chunks"; value: AnyChunk[] } => e.kind === "chunks",
    )
    .flatMap((e) => e.value);

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createRunRenderer — native streaming", () => {
  it("streams multiple AG-UI messages into ONE turn message, separated by a blank line", async () => {
    const fake = makeFakeClient();
    const nt = makeFakeNativeTransport();
    const { subscriber: sub, finish } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport },
    });

    await sub.onTextMessageStartEvent!({ event: { messageId: "m1" } } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "Hello" },
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m1" } } as never);
    await sub.onTextMessageStartEvent!({ event: { messageId: "m2" } } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "m2", delta: "World" },
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m2" } } as never);
    await finish!();

    expect(nt.transport.startStream).toHaveBeenCalledTimes(1);
    expect(nt.messages).toHaveLength(1);
    expect(textOf(nt.messages[0]!.events)).toBe("Hello\n\nWorld");
    expect(nt.messages[0]!.stopped).toBe(true);
  });

  it("surfaces tool calls as in-message task_update chunks (no :wrench: rows)", async () => {
    const fake = makeFakeClient();
    const nt = makeFakeNativeTransport();
    const { subscriber: sub, finish } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport },
    });

    sub.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "thinking…" },
    } as never);
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    await finish!();

    // No legacy :wrench: rows posted to the channel.
    expect(fake.posts.filter((p) => p.text.includes(":wrench:"))).toHaveLength(
      0,
    );
    const chunks = chunksOf(nt.messages[0]!.events);
    expect(chunks).toEqual([
      {
        type: "task_update",
        id: "t1",
        title: "Using `search`",
        status: "in_progress",
      },
      {
        type: "task_update",
        id: "t1",
        title: "Used `search`",
        status: "complete",
      },
    ]);
  });

  it("showToolStatus:false suppresses tool progress entirely (no chunks, no rows)", async () => {
    const fake = makeFakeClient();
    const nt = makeFakeNativeTransport();
    const { subscriber: sub, finish } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport },
      showToolStatus: false,
    });

    sub.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "answer" },
    } as never);
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "t1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    await finish!();

    // No task_update chunks and no :wrench: rows — only the text answer.
    expect(chunksOf(nt.messages[0]!.events)).toHaveLength(0);
    expect(fake.posts.filter((p) => p.text.includes(":wrench:"))).toHaveLength(
      0,
    );
    expect(textOf(nt.messages[0]!.events)).toBe("answer");
  });

  it("attaches the feedback row at finish only when text was streamed", async () => {
    const blocks: KnownBlock[] = [
      { type: "context_actions", elements: [] } as unknown as KnownBlock,
    ];

    // (a) with text → feedback attached.
    const withText = makeFakeNativeTransport();
    const r1 = createRunRenderer({
      transport: makeFakeClient().transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: withText.transport },
      feedbackBlocks: blocks,
    });
    r1.subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "answer" },
    } as never);
    await r1.finish!();
    expect(withText.messages[0]!.stopBlocks).toBe(blocks);

    // (b) no text (tool-only run) → no stream, nothing to attach.
    const noText = makeFakeNativeTransport();
    const r2 = createRunRenderer({
      transport: makeFakeClient().transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: noText.transport },
      feedbackBlocks: blocks,
    });
    await r2.finish!();
    expect(noText.messages).toHaveLength(0);
  });

  it("degrades to :wrench: rows after a chunk append fails", async () => {
    const fake = makeFakeClient();
    const nt = makeFakeNativeTransport({ failChunks: true });
    const onChunkFailure = vi.fn();
    const { subscriber: sub, finish } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport, onChunkFailure },
    });

    // First tool call tries a chunk, which fails and flips the degradation flag.
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    await tick(); // let the queued chunk append run and fail
    expect(onChunkFailure).toHaveBeenCalled();

    // Second tool call now falls back to a :wrench: status row.
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t2", toolCallName: "lookup" },
    } as never);
    await finish!();

    expect(fake.posts.some((p) => p.text.includes(":wrench:"))).toBe(true);
  });

  it("does NOT attach the feedback row to an interrupted partial reply", async () => {
    const nt = makeFakeNativeTransport();
    const blocks: KnownBlock[] = [
      { type: "context_actions", elements: [] } as unknown as KnownBlock,
    ];
    const { subscriber: sub, markInterrupted } = createRunRenderer({
      transport: makeFakeClient().transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport },
      feedbackBlocks: blocks,
    });
    sub.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "partial" },
    } as never);
    await markInterrupted!();
    expect(nt.messages[0]!.stopped).toBe(true);
    expect(nt.messages[0]!.stopBlocks).toBeUndefined();
  });

  it("markInterrupted finalizes the single turn stream with the interrupted marker", async () => {
    const fake = makeFakeClient();
    const nt = makeFakeNativeTransport();
    const { subscriber: sub, markInterrupted } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      nativeStreaming: { transport: nt.transport },
    });

    sub.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "Once upon a time" },
    } as never);
    await markInterrupted!();

    expect(nt.messages).toHaveLength(1);
    expect(nt.messages[0]!.stopped).toBe(true);
    expect(textOf(nt.messages[0]!.events)).toContain("_(interrupted)_");
  });
});
