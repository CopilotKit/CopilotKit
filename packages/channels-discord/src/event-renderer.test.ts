import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "./event-renderer.js";

function fakeChannel() {
  const sent: {
    id: string;
    content: string;
    edit: ReturnType<typeof vi.fn>;
  }[] = [];
  let n = 0;
  return {
    sendTyping: vi.fn(async () => {}),
    send: vi.fn(async (payload: string | { content: string }) => {
      const id = `m${++n}`;
      const msg = {
        id,
        content:
          typeof payload === "string" ? payload : (payload.content ?? ""),
        edit: vi.fn(async (p: string | { content: string }) => {
          msg.content = typeof p === "string" ? p : (p.content ?? msg.content);
        }),
      };
      sent.push(msg);
      return msg;
    }),
    _sent: sent,
  };
}

describe("createRunRenderer", () => {
  it("fires a typing indicator on run start", () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    r.subscriber.onRunStartedEvent?.({ event: {} } as any);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
    // Stop the heartbeat so the interval doesn't dangle past the test.
    r.subscriber.onRunFinishedEvent?.({ event: {} } as any);
  });

  it("keeps the typing indicator alive across a long tool call, then stops on finish", () => {
    vi.useFakeTimers();
    try {
      const channel = fakeChannel();
      const r = createRunRenderer({ channel: channel as any });
      r.subscriber.onRunStartedEvent?.({ event: {} } as any);
      // Immediate ping on start.
      expect(channel.sendTyping).toHaveBeenCalledTimes(1);
      // Discord typing expires ~10 s; the heartbeat refreshes every 8 s so a
      // 40 s tool call never goes dead.
      vi.advanceTimersByTime(8000);
      expect(channel.sendTyping).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(8000 * 4); // ~40 s total elapsed
      expect(channel.sendTyping).toHaveBeenCalledTimes(6);
      // Once the run finishes, the heartbeat stops — no lingering "typing".
      r.subscriber.onRunFinishedEvent?.({ event: {} } as any);
      vi.advanceTimersByTime(8000 * 5);
      expect(channel.sendTyping).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams text deltas into a single edited message", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "a" },
    } as any);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "a", delta: "Hel" },
    } as any);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "a", delta: "lo" },
    } as any);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "a" },
    } as any);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel._sent[0]!.content).toContain("Hello");
  });

  it("routes each chunk's edits to its own Discord message", async () => {
    // A reply longer than the 2000-char Discord limit is split by
    // ChunkedMessageStream into multiple Discord messages. Each posted
    // message must receive ONLY its own slice via `edit()` — a regression
    // here (a single per-AG-UI-message handle) routes every edit to the
    // last-posted message, freezing earlier chunks on their placeholder.
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });

    // Two distinct, newline-delimited blocks. Total > 2000 so the chunker
    // freezes a boundary at the newline near the limit, producing exactly
    // two Discord messages.
    const first = "A".repeat(1500);
    const second = "B".repeat(600);
    const full = `${first}\n${second}`;

    r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "a" },
    } as any);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "a", delta: full },
    } as any);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "a" },
    } as any);

    // Two Discord messages posted (one per chunk).
    expect(channel.send).toHaveBeenCalledTimes(2);

    const [msg1, msg2] = channel._sent;

    // Concatenate every edit each message received. The discriminator is
    // that NO edit for a given message may carry the *other* chunk's
    // content. With the regression (a single per-AG-UI-message handle keyed
    // by messageId), chunk 0's final flush is minted after chunk 1's
    // placeholder, so it overwrites the shared handle and msg2 receives an
    // "A"-bearing edit — exactly what this asserts against.
    const editsOf = (m: (typeof channel._sent)[number]): string =>
      m.edit.mock.calls
        .map(([p]) => (typeof p === "string" ? p : (p?.content ?? "")))
        .join(" ");

    const msg1Edits = editsOf(msg1!);
    const msg2Edits = editsOf(msg2!);

    // Both messages were actually edited (not left on their placeholder).
    expect(msg1!.edit).toHaveBeenCalled();
    expect(msg2!.edit).toHaveBeenCalled();

    // Each message only ever sees its OWN chunk's content.
    expect(msg1Edits).toContain("A");
    expect(msg1Edits).not.toContain("B");
    expect(msg2Edits).toContain("B");
    expect(msg2Edits).not.toContain("A");
  });

  it("captures a tool call for the run loop", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "render_card",
      toolCallArgs: { id: "x" },
    } as any);
    expect(r.getCapturedToolCalls()).toEqual([
      {
        toolCallId: "t1",
        toolCallName: "render_card",
        toolCallArgs: { id: "x" },
      },
    ]);
  });

  it("captures an on_interrupt custom event", () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    r.subscriber.onCustomEvent?.({
      event: { name: "on_interrupt", value: { q: 1 } },
    } as any);
    expect(r.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { q: 1 },
    });
  });

  it("posts a visible warning when an agent run errors", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    await r.subscriber.onRunErrorEvent?.({ event: { message: "boom" } } as any);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel._sent[0]!.content).toContain("boom");
  });

  it("does not post an error notice when the run was self-aborted", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    await r.markInterrupted();
    await r.subscriber.onRunErrorEvent?.({ event: { message: "boom" } } as any);
    expect(channel.send).not.toHaveBeenCalled();
  });
});
