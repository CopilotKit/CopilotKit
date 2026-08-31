import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "./event-renderer.js";

function evt<T extends object>(o: T) {
  return { event: o } as any;
}

describe("createRunRenderer (buffered)", () => {
  it("buffers text deltas and sends once on TEXT_MESSAGE_END", async () => {
    const sent: string[] = [];
    const r = createRunRenderer({
      send: async (text) => {
        sent.push(text);
      },
    });
    const s = r.subscriber;
    s.onTextMessageStartEvent?.(evt({ messageId: "m1" }));
    s.onTextMessageContentEvent?.(evt({ messageId: "m1", delta: "Hello " }));
    s.onTextMessageContentEvent?.(evt({ messageId: "m1", delta: "world" }));
    expect(sent).toEqual([]); // nothing sent mid-stream — no editing
    await s.onTextMessageEndEvent?.(evt({ messageId: "m1" }));
    expect(sent).toEqual(["Hello world"]);
  });

  it("invokes onAssistantText with the final text", async () => {
    const persisted: string[] = [];
    const r = createRunRenderer({
      send: async () => {},
      onAssistantText: (t) => persisted.push(t),
    });
    const s = r.subscriber;
    s.onTextMessageStartEvent?.(evt({ messageId: "m" }));
    s.onTextMessageContentEvent?.(evt({ messageId: "m", delta: "Hi" }));
    await s.onTextMessageEndEvent?.(evt({ messageId: "m" }));
    expect(persisted).toEqual(["Hi"]);
  });

  it("captures tool calls for the run loop", async () => {
    const r = createRunRenderer({ send: async () => {} });
    const s = r.subscriber;
    await s.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "do_x",
      toolCallArgs: { a: 1 },
    } as any);
    expect(r.getCapturedToolCalls()).toEqual([
      { toolCallId: "t1", toolCallName: "do_x", toolCallArgs: { a: 1 } },
    ]);
  });

  it("captures interrupts via matching custom event", () => {
    const r = createRunRenderer({ send: async () => {} });
    r.subscriber.onCustomEvent?.({
      event: { name: "on_interrupt", value: { q: 1 } },
    } as any);
    expect(r.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { q: 1 },
    });
  });

  it("does not send after markInterrupted", async () => {
    const sent: string[] = [];
    const r = createRunRenderer({ send: async (t) => void sent.push(t) });
    const s = r.subscriber;
    s.onTextMessageStartEvent?.(evt({ messageId: "m" }));
    s.onTextMessageContentEvent?.(evt({ messageId: "m", delta: "partial" }));
    await r.markInterrupted();
    await s.onTextMessageEndEvent?.(evt({ messageId: "m" }));
    // partial reply flushed once by markInterrupted with an interrupted marker;
    // the late END is ignored.
    expect(sent).toEqual(["partial\n_(interrupted)_"]);
  });
});
